import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import * as dsh from "@bthwani/dsh";
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
  const calls=[];
  let status=200;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    const target=new URL(url);calls.push([target.pathname,options.method]);
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

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=="object"?[]:[tree,...nodes(tree.props?.children)];
const tick=()=>new Promise(setImmediate);
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail("employee UI did not settle");}
test("Employee screen loads current scope and retains the original operation through network loss and remount",async()=>{
  const tmp=mkdtempSync(join(tmpdir(),"merchant-employees-"));
  try{
    const root=resolve(import.meta.dirname,"../../../../..");
    const source=resolve(import.meta.dirname,"employees-screen.tsx");
    const compiled=spawnSync(process.execPath,[join(root,"node_modules/typescript/bin/tsc"),source,
      "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--outDir",tmp],
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
      "./employee-transport":{readEmployeeDetail(actorId,storeId,id,signal){return new Promise((resolve,reject)=>details.push({actorId,storeId,id,signal,resolve,reject}));},readEmployees(actorId,storeId,signal,cursor){return new Promise((resolve,reject)=>reads.push({actorId,storeId,signal,cursor,resolve,reject}));},
        saveEmployee(actorId,storeId,input,signal){return new Promise((resolve,reject)=>writes.push({actorId,storeId,input,signal,resolve,reject}));}}};
    const mod={exports:{}};
    new Function("require","module","exports","window",code)(name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},mod,mod.exports,
      {localStorage:{getItem:get,setItem:set,removeItem:remove},navigator:{locks:{request:(_key,fn)=>fn()}},addEventListener(type,listener){assert.equal(type,"focus");focusListener=listener;},removeEventListener(){focusListener=undefined;}});
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
    assert.equal(storage.size,0);
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
    staleSave.props.onPress();for(let i=0;i<8;i++)await tick();assert.equal(writes.length,4,"a stale registration action must not create a new operation");assert.equal(storage.size,0);
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
    restart();
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
