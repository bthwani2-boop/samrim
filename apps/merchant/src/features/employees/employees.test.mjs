import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import * as dsh from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { GET, POST } from "../../../app/api/admission+api.ts";
import * as recovery from "../onboarding/merchant-registration-attempt.ts";

const id="00000000-0000-4000-8000-000000000001";
const record={id,displayName:"موظف تجريبي",department:"عمليات",jobTitle:"منسق",startDate:"2026-11-22",endDate:null};
const audit={employeeId:id,registeredByActorId:"merchant-a",recordedAt:"2026-11-24T18:00:00Z"};
const json=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const input={operationId:id,displayName:record.displayName,department:record.department,jobTitle:record.jobTitle,startDate:record.startDate};

test("Merchant employees BFF scopes GET and POST to a verified actor and Store",async t=>{
  const identity="http://127.0.0.1:13310",owner="http://127.0.0.1:13311";
  const bearer=Buffer.alloc(32,12).toString("base64url");
  const env={MERCHANT_SYNTHETIC_IDENTITY_ORIGIN:process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN,
    MERCHANT_SYNTHETIC_DSH_ORIGIN:process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN};
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN=owner;
  t.after(()=>{for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const calls=[]; const employeeQueries=[];
  let status=200;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    const target=new URL(url);calls.push([target.pathname,options.method]);employeeQueries.push(target.search);
    assert.equal(options.credentials,"omit");assert.equal(options.headers.Authorization,"Bearer "+bearer);
    if(target.origin===identity)return json({actorId:"merchant-a",role:"merchant",sessionExpiresAt:new Date(Date.now()+120000).toISOString()});
    assert.equal(target.origin,owner);
    const base="/v1/stores/store-a/employees";
    assert.ok([base,base+"/"+id,base+"/"+id+"/registration-audit"].includes(target.pathname));
    if(status!==200)return json({code:"EMPLOYEE_SCOPE_FORBIDDEN"},status);
    if(target.pathname.endsWith("/registration-audit"))return json(audit);
    if(target.pathname.endsWith("/"+id))return json(record);
    if(options.method==="POST"){assert.deepEqual(JSON.parse(options.body),input);return json({id});}
    return json({items:[record],nextCursor:null});
  });
  const request=(method="GET",actor="merchant-a",query="?employees=store-a",body=input,token=bearer)=>
    new Request("http://localhost:18102/api/admission"+query,{method,headers:{
      ...(token?{Cookie:"bthwani_merchant_admission="+token}:{}),
      "X-Merchant-Context":actor,"Content-Type":"application/json",Origin:"http://localhost:18102"},
      ...(method==="POST"?{body:JSON.stringify(body)}:{})});
  let response=await GET(request());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{employees:{actorId:"merchant-a",storeId:"store-a",page:{items:[record],nextCursor:null}}});
  response=await GET(request("GET","merchant-a","?employees=store-a&endState=NO_END_DATE"));
  assert.equal(response.status,200);
  assert.equal(employeeQueries.at(-1),"?endState=NO_END_DATE");
  assert.deepEqual((await response.json()).employees.page,{items:[record],nextCursor:null});
  response=await GET(request("GET","merchant-a","?employees=store-a&endState=HAS_END_DATE"));
  assert.equal(response.status,503,"owner page inconsistent with the filter");
  assert.deepEqual(await response.json(),{code:"OWNER_UNAVAILABLE"});
  const beforeInvalid=calls.length;
  for(const query of ["?employees=store-a&endState=ACTIVE","?employees=store-a&endState=","?employees=store-a&endState=NO_END_DATE&endState=HAS_END_DATE","?employees=store-a&employeeId="+id+"&endState=NO_END_DATE"]){
    assert.equal((await GET(request("GET","merchant-a",query))).status,400);
  }
  assert.equal(calls.length,beforeInvalid);
  response=await POST(request("POST"));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{employee:{actorId:"merchant-a",storeId:"store-a",id}});
  response=await GET(request("GET","merchant-a","?employees=store-a&employeeId="+id));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{employees:{actorId:"merchant-a",storeId:"store-a",detail:{employee:record,audit}}});
  const before=calls.length;
  assert.equal((await GET(request("GET","merchant-a","?employees=store-a&employeeId="+id+"&cursor="+id))).status,400);
  assert.equal((await GET(request("GET","merchant-a","?employees=store-a&employeeId=bad"))).status,400);
  assert.equal((await GET(request("GET","merchant-a","?employees=store-a&employees=store-b"))).status,400);
  assert.equal((await POST(request("POST","merchant-a","?employees=store-a",{...input,employerId:"merchant-b"}))).status,400);
  assert.equal((await GET(request("GET","merchant-a","?employees=store-a",input,""))).status,401);
  assert.equal(calls.length,before);
  assert.equal((await POST(request("POST","merchant-b"))).status,403);
  assert.deepEqual(calls.at(-1),["/v1/sessions/current","GET"]);
  status=403;
  response=await GET(request());
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{code:"EMPLOYEE_SCOPE_FORBIDDEN"});
});

// Retain uncached modules until Node collects source coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);

function employeeTransport(platform, withNativeMerchantSession) {
  const tmp = mkdtempSync(join(tmpdir(), "merchant-employee-transport-"));
  try {
    const root = resolve(import.meta.dirname, "../../../../..");
    const source = resolve(import.meta.dirname, "employee-transport.ts");
    const compiled = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--inlineSourceMap", "--inlineSources", "--outDir", tmp],
      { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const mod = loadMappedRenderFixture(readFileSync(join(tmp, "employee-transport.js"), "utf8"), source, {
      "@bthwani/dsh": dsh,
      "react-native": { Platform: { OS: platform } },
      "../access/admission-transport": { withNativeMerchantSession },
    });
    loadedModules.push(mod);
    return mod.exports;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

test("actual Web employee transport binds employer scope and rejects stale or uncertain acknowledgements", async t => {
  const transport = employeeTransport("web", () => assert.fail("Web must not use native credentials"));
  const actor = "merchant-a", store = "store-a";
  const signal = new AbortController().signal;
  const cursor = "00000000-0000-4000-8000-000000000000";
  const page = { items: [record], nextCursor: null };
  const wrap = (payload, writing = false) => ({ [writing ? "employee" : "employees"]: { actorId: actor, storeId: store, ...payload } });
  const calls = [];
  let respond = () => json(wrap({ page }));
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return respond(); });
  const read = (s = signal) => transport.readEmployees(actor, store, s, cursor, "NO_END_DATE");
  const detail = () => transport.readEmployeeDetail(actor, store, id, signal);
  const save = (s = signal) => transport.saveEmployee(actor, store, input, s);
  assert.deepEqual(await read(), page);
  assert.deepEqual(Object.fromEntries(new URL(calls[0].url, "http://localhost").searchParams), {
    employees: store, cursor, endState: "NO_END_DATE",
  });
  assert.deepEqual(calls[0].options, { method: "GET", signal, credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "X-Merchant-Context": actor } });
  respond = () => json(wrap({ detail: { employee: record, audit } }));
  assert.deepEqual(await detail(), { employee: record, audit });
  assert.equal(new URL(calls[1].url, "http://localhost").searchParams.get("employeeId"), id);
  respond = () => json(wrap({ id }, true));
  assert.equal(await save(), id);
  assert.deepEqual(calls[2].options, { method: "POST", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "X-Merchant-Context": actor, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  for (const args of [
    ["", store, signal], [actor, "../store", signal], [actor, store, signal, "bad"],
    [actor, store, signal, undefined, "ACTIVE"],
  ]) await assert.rejects(transport.readEmployees(...args), { code: "EMPLOYEE_QUERY_INVALID" });
  await assert.rejects(transport.readEmployeeDetail(actor, store, "../employee", signal), { code: "EMPLOYEE_QUERY_INVALID" });
  await assert.rejects(transport.saveEmployee(actor, store, { ...input, operationId: "bad" }, signal), { code: "EMPLOYEE_QUERY_INVALID" });
  await assert.rejects(read(AbortSignal.abort()), { name: "AbortError" });
  assert.equal(calls.length, 3);
  for (const body of [
    { employees: { actorId: "merchant-b", storeId: store, page } },
    { employees: { actorId: actor, storeId: "store-b", page } },
    { employees: { actorId: actor, storeId: store, page, extra: true } },
    wrap({ page: { ...page, items: [{ ...record, endDate: "2027-01-01" }] } }),
    [], null,
  ]) {
    respond = () => json(body);
    await assert.rejects(read(), { code: "OWNER_RESPONSE_INVALID" });
  }
  for (const value of [null, { employee: record }, { employee: { ...record, id: cursor }, audit }, { employee: record, audit: { ...audit, employeeId: cursor } }]) {
    respond = () => json(wrap({ detail: value }));
    await assert.rejects(detail(), { code: "OWNER_RESPONSE_INVALID" });
  }
  respond = () => json(wrap({ id: "bad" }, true));
  await assert.rejects(save(), { code: "OPERATION_RESULT_UNKNOWN" });
  for (const [operation, unknown] of [[read, false], [save, true]]) {
    respond = () => { throw new Error("connection closed"); };
    await assert.rejects(operation(), { code: unknown ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" });
    respond = () => new Response("not JSON");
    await assert.rejects(operation(), { code: unknown ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID" });
    respond = () => json({ code: "EMPLOYEE_SCOPE_FORBIDDEN" }, 403);
    await assert.rejects(operation(), { status: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    respond = () => json([], 503);
    await assert.rejects(operation(), { code: unknown ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" });
    respond = () => Response.json({});
    await assert.rejects(operation(), { code: unknown ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID" });
    respond = () => json({}, 201);
    await assert.rejects(operation(), { code: unknown ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID" });
    const late = new AbortController();
    respond = () => ({ json: async () => { late.abort(); return {}; } });
    await assert.rejects(operation(late.signal), { code: unknown ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE" });
  }
});

test("actual Android employee transport uses canonical DSH read, audit and idempotent registration", async t => {
  const owner = "http://127.0.0.1:13311";
  const token = Buffer.alloc(32, 12).toString("base64url");
  const scopes = [], calls = [];
  const transport = employeeTransport("android", async (signal, invoke, actor, write = false) => {
    scopes.push({ signal, actor, write });
    return invoke(token, owner);
  });
  const page = { items: [record], nextCursor: null };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    calls.push({ target, options });
    if (options.method === "POST") return json({ id });
    if (target.pathname.endsWith("/registration-audit")) return json(audit);
    if (target.pathname.endsWith(id)) return json(record);
    return json(page);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await transport.readEmployees("merchant-a", "store-a", signal, undefined, "NO_END_DATE"), page);
  assert.deepEqual(await transport.readEmployeeDetail("merchant-a", "store-a", id, signal), { employee: record, audit });
  assert.equal(await transport.saveEmployee("merchant-a", "store-a", input, signal), id);
  assert.deepEqual(scopes, [false, false, true].map(write => ({ signal, actor: "merchant-a", write })));
  assert.deepEqual(calls.map(call => [call.options.method, call.target.pathname]), [
    ["GET", "/v1/stores/store-a/employees"],
    ["GET", `/v1/stores/store-a/employees/${id}`],
    ["GET", `/v1/stores/store-a/employees/${id}/registration-audit`],
    ["POST", "/v1/stores/store-a/employees"],
  ]);
  assert.equal(calls[0].target.searchParams.get("endState"), "NO_END_DATE");
  assert.ok(calls.every(call => call.target.origin === owner && call.options.headers.Authorization === `Bearer ${token}`));
  assert.deepEqual(JSON.parse(calls[3].options.body), input);
});

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=="object"?[]:[tree,...nodes(tree.props?.children)];
const tick=()=>new Promise(setImmediate);
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail("employee UI did not settle");}
test("Employee screen loads current scope and retains the original operation through network loss and remount",async t=>{
  const tmp=mkdtempSync(join(tmpdir(),"merchant-employees-"));
  try{
    const root=resolve(import.meta.dirname,"../../../../..");
    const source=resolve(import.meta.dirname,"employees-screen.tsx");
    const compiled=spawnSync(process.execPath,[join(root,"node_modules/typescript/bin/tsc"),source,
      "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--inlineSourceMap","--inlineSources","--outDir",tmp],
      {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
    assert.equal(compiled.status,0,compiled.stderr||compiled.stdout);
    const code=readFileSync(join(tmp,"employees-screen.js"),"utf8");
    let state=[],refs=[],si=0,ri=0,cleanup,mounted=false;
    const reads=[],writes=[],details=[],storage=new Map();
    const platform={OS:"web"}; let nativeListener, focusListener;
    const get=key=>storage.get(key)??null;
    const set=(key,value)=>storage.set(key,value);
    const remove=key=>storage.delete(key);
    const react={useState(initial){const i=si++;if(!(i in state))state[i]=initial;return [state[i],next=>{state[i]=typeof next==="function"?next(state[i]):next;}];},
      useRef(initial){const i=ri++;refs[i]??={current:initial};return refs[i];},
      useLayoutEffect(fn){if(!mounted){mounted=true;cleanup=fn();}}};
    const jsx=(type,props,key)=>({type,props:props??{},key});
    const mocks={"@bthwani/dsh":dsh,"@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},
      "expo-crypto":{randomUUID,CryptoDigestAlgorithm:{SHA256:"sha256"},digestStringAsync:async(algorithm,value)=>createHash(algorithm).update(value).digest("hex")},
      "expo-secure-store":{getItemAsync:async key=>get(key),setItemAsync:async(key,value)=>set(key,value),deleteItemAsync:async key=>remove(key)},
      react,"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},"react-native":{Platform:platform,AppState:{addEventListener(type,listener){assert.equal(type,"change");nativeListener=listener;return {remove(){nativeListener=undefined;}};}},View:"View",Text:"Text",TextInput:"TextInput",Pressable:"Pressable"},
      "../../components/merchant-capability-screen":{__esModule:true,default:"Unavailable"},"../onboarding/merchant-registration-attempt":recovery,
      "./employee-transport":{readEmployeeDetail(actorId,storeId,id,signal){return new Promise((resolve,reject)=>details.push({actorId,storeId,id,signal,resolve,reject}));},readEmployees(actorId,storeId,signal,cursor,endState){return new Promise((resolve,reject)=>reads.push({actorId,storeId,signal,cursor,endState,resolve,reject}));},
        saveEmployee(actorId,storeId,input,signal){return new Promise((resolve,reject)=>writes.push({actorId,storeId,input,signal,resolve,reject}));}}};
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    t.after(() => {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else delete globalThis.window;
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true, writable: true,
      value: {localStorage:{getItem:get,setItem:set,removeItem:remove},navigator:{locks:{request:(_key,fn)=>fn()}},addEventListener(type,listener){assert.equal(type,"focus");focusListener=listener;},removeEventListener(){focusListener=undefined;}},
    });
    const mod = loadMappedRenderFixture(code, source, mocks);
    loadedModules.push(mod);
    const scope={actorId:"merchant-a",storeId:"store-a"};
    const render=(p=scope)=>{si=0;ri=0;const c=mod.exports.default(p);return c.type(c.props);};
    const findInput=label=>nodes(render()).find(n=>n.type==="TextInput"&&n.props.accessibilityLabel===label);
    const findButton=label=>nodes(render()).find(n=>n.type==="Pressable"&&nodes(n.props.children).some(x=>x.props?.children===label));
    const fill=()=>{for(const [label,value] of [["اسم الموظف",input.displayName],["القسم",input.department],["المسمى الوظيفي",input.jobTitle],["بداية العمل (YYYY-MM-DD)",input.startDate]])findInput(label).props.onChangeText(value);};
    const restart=()=>{cleanup();state=[];refs=[];mounted=false;};
    assert.equal(mod.exports.default().type,"Unavailable");
    render();await until(()=>reads.length===1);
    assert.equal(reads[0].actorId,scope.actorId);assert.equal(reads[0].storeId,scope.storeId);
    assert.equal(findInput("اسم الموظف"),undefined);
    reads[0].resolve({items:[record],nextCursor:null});
    await until(()=>!!findInput("اسم الموظف")&&findInput("اسم الموظف").props.editable);
    findButton("التفاصيل وسجل التسجيل").props.onPress();await until(()=>details.length===1);
    assert.deepEqual([details[0].actorId,details[0].storeId,details[0].id],[scope.actorId,scope.storeId,id]);
    details[0].resolve({employee:record,audit});await until(()=>nodes(render()).some(n=>n.props?.testID==="merchant-employee-detail"));
    assert.ok(JSON.stringify(render()).includes(audit.recordedAt));
    findButton("إغلاق التفاصيل").props.onPress();assert.ok(!nodes(render()).some(n=>n.props?.testID==="merchant-employee-detail"));
    fill();findButton("حفظ سجل الموظف").props.onPress();await until(()=>writes.length===1);
    const first=writes[0];assert.equal(storage.size,1);
    assert.doesNotMatch([...storage.values()][0],/موظف|عمليات|منسق|2026-11-22/);
    first.reject(new Error("lost acknowledgment"));await until(()=>!!findButton("إعادة تأكيد التسجيل"));
    restart();platform.OS="android";render();await until(()=>reads.length===2);
    reads[1].resolve({items:[record],nextCursor:null});await until(()=>!!findInput("اسم الموظف")&&findInput("اسم الموظف").props.editable);
    fill();findButton("إعادة تأكيد التسجيل").props.onPress();await until(()=>writes.length===2);
    assert.deepEqual(writes[1].input,first.input);writes[1].resolve(id);await until(()=>reads.length===3);
    assert.equal(storage.size,1);
    assert.equal(JSON.parse([...storage.values()][0]).settled,true);
    reads[2].resolve({items:[record],nextCursor:null});await until(()=>!!findButton("التفاصيل وسجل التسجيل")&&!findButton("التفاصيل وسجل التسجيل").props.disabled);
    findButton("التفاصيل وسجل التسجيل").props.onPress();await until(()=>details.length===2);
    details[1].reject({status:403});await until(()=>!JSON.stringify(render()).includes(record.displayName));
    assert.equal(findInput("اسم الموظف"),undefined);
    assert.notEqual(mod.exports.default(scope).key,mod.exports.default({...scope,storeId:"store-b"}).key);
    assert.ok(nativeListener, "Android foreground must trigger an owner revalidation");
    nativeListener("background");
    assert.equal(reads.length,3);
    nativeListener("active");
    await until(()=>reads.length===4);
    reads[3].resolve({items:[record],nextCursor:null});
    await until(()=>!!findInput("اسم الموظف")&&findInput("اسم الموظف").props.editable);
    findButton("التفاصيل وسجل التسجيل").props.onPress();
    await until(()=>details.length===3);
    nativeListener("active");
    assert.equal(details[2].signal.aborted,true);
    assert.ok(!JSON.stringify(render()).includes(record.displayName),"private records hidden while checking");
    await until(()=>reads.length===5);
    details[2].resolve({employee:record,audit});
    reads[4].reject({status:403});
    await until(()=>!findButton("جارٍ الاتصال بـ DSH…"));
    assert.ok(!JSON.stringify(render()).includes(record.displayName),"late detail cannot restore denied records");

    nativeListener("active");
    await until(()=>reads.length===6);
    reads[5].resolve({items:[record],nextCursor:null});
    await until(()=>!!findInput("اسم الموظف")&&findInput("اسم الموظف").props.editable);
    fill();const staleSave=findButton("حفظ سجل الموظف");staleSave.props.onPress();
    await until(()=>writes.length===3);
    nativeListener("active");
    assert.equal(writes[2].signal.aborted,false,"do not cancel a potentially committed write on resume");
    assert.equal(reads.length,6,"owner refresh waits for the active write");
    assert.ok(!JSON.stringify(render()).includes(record.displayName));
    writes[2].reject(new Error("lost acknowledgment during resume"));
    await until(()=>reads.length===7);
    reads[6].resolve({items:[record],nextCursor:null});
    await until(()=>!!findButton("إعادة تأكيد التسجيل")&&!findButton("إعادة تأكيد التسجيل").props.disabled);
    findButton("إعادة تأكيد التسجيل").props.onPress();
    await until(()=>writes.length===4);
    assert.deepEqual(writes[3].input,writes[2].input,"resume must retain exact operation identity");
    nativeListener("active");
    assert.equal(writes[3].signal.aborted,false);
    assert.equal(reads.length,7,"successful write also owns its handoff");
    writes[3].resolve(id);
    await until(()=>reads.length===8);
    reads[7].resolve({items:[record],nextCursor:null});
    await until(()=>!!findInput("اسم الموظف")&&findInput("اسم الموظف").props.editable);
    staleSave.props.onPress();for(let i=0;i<8;i++)await tick();assert.equal(writes.length,4,"a stale registration action must not create a new operation");assert.equal(storage.size,1);
    assert.equal(JSON.parse([...storage.values()][0]).settled,true);
    restart();
    assert.equal(nativeListener,undefined);
    platform.OS="web";render();
    await until(()=>reads.length===9);
    reads[8].resolve({items:[record],nextCursor:null});
    await until(()=>!!findInput("اسم الموظف")&&findInput("اسم الموظف").props.editable);
    assert.ok(focusListener,"browser focus must trigger owner revalidation");
    focusListener();
    await until(()=>reads.length===10);
    assert.ok(!JSON.stringify(render()).includes(record.displayName));
    reads[9].reject({status:403});
    await until(()=>!findButton("جارٍ الاتصال بـ DSH…"));
    assert.ok(!JSON.stringify(render()).includes(record.displayName));
    focusListener();
    await until(()=>reads.length===11);
    reads[10].resolve({items:[record],nextCursor:null});
    const filter=id=>nodes(render()).find(n=>n.props?.testID==="employee-end-filter-"+id);
    await until(()=>!!filter("HAS_END_DATE")&&!filter("HAS_END_DATE").props.disabled);
    const retained=filter("ALL");
    filter("HAS_END_DATE").props.onPress();
    await until(()=>reads.length===12);
    assert.equal(reads[11].endState,"HAS_END_DATE");
    assert.equal(reads[11].cursor,undefined);
    assert.ok(!JSON.stringify(render()).includes(record.displayName));
    retained.props.onPress();
    assert.equal(reads.length,12,"superseded filter action cannot switch the active query");
    const ended={...record,endDate:"2027-01-01"};
    reads[11].resolve({items:[ended],nextCursor:null});
    await until(()=>filter("HAS_END_DATE")?.props.accessibilityState.checked===true);
    focusListener();
    await until(()=>reads.length===13);
    assert.equal(reads[12].endState,"HAS_END_DATE","refresh retains the selected filter");
    reads[12].resolve({items:[ended],nextCursor:null});
    await until(()=>!!filter("ALL")&&!filter("ALL").props.disabled);
    filter("ALL").props.onPress();
    await until(()=>reads.length===14);
    assert.equal(reads[13].endState,undefined);
    reads[13].resolve({items:[record],nextCursor:null});
    await until(()=>filter("ALL")?.props.accessibilityState.checked===true);
    restart();
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
