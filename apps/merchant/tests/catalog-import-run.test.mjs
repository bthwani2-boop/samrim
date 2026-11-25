import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import * as dsh from "@bthwani/dsh";
import {GET,PATCH, PUT} from "../app/api/admission+api.ts";
import { buildImportManifest } from "../src/features/catalog/catalog-import-data.ts";

const actorId="merchant-a",storeId="store-a",runId="run-0001",sourceSha256="a".repeat(64);
const manifest={sourceSha256,rows:[{row:2,name:"Milk",priceYer:"100",stockUnits:"2",offerId:"of-a",expectedVersion:1}]};
const initial={actorId,storeId,runId,sourceSha256,total:1,processed:0,offset:0,outcomes:[]};
const complete={...initial,processed:1,outcomes:[{row:2,status:"ACCEPTED",reason:"UPDATED",offerId:"of-a",resultVersion:2}]};
const json=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
test("import admission binds owner scope, denies foreign origin/actor and rechecks session after result",async t=>{
  const identity="http://127.0.0.1:13310",owner="http://127.0.0.1:13311";
  const bearer=Buffer.alloc(32,9).toString("base64url");
  const before={MERCHANT_SYNTHETIC_IDENTITY_ORIGIN:process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN,MERCHANT_SYNTHETIC_DSH_ORIGIN:process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN};
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN=owner;
  t.after(()=>{for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const calls=[];let revoke=false,revoked=false;
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    const target=new URL(url);assert.equal(init.headers.Authorization,"Bearer "+bearer);
    if(target.origin===identity)return revoked?json({code:"UNAUTHENTICATED"},401):json({actorId,role:"merchant",sessionExpiresAt:new Date(Date.now()+120000).toISOString()});
    assert.equal(target.origin,owner);assert.equal(target.pathname,"/v1/stores/store-a/catalog-imports/run-0001");
    calls.push(init.method);if(init.method==="PUT")assert.deepEqual(JSON.parse(init.body),manifest);
    if(revoke)revoked=true;
    return json(init.method==="PATCH"?complete:initial);
  });
  const request=(method,{actor=actorId,origin="http://localhost:18102",token=bearer,query="?catalogImport=store-a&run=run-0001",body=manifest}={})=>new Request("http://localhost:18102/api/admission"+query,{method,headers:{"X-Merchant-Context":actor,Origin:origin,"Content-Type":"application/json",...(token?{Cookie:"bthwani_merchant_admission="+token}:{})},...(method==="PUT"?{body:JSON.stringify(body)}:{})});
  assert.equal((await PUT(request("PUT",{origin:"https://foreign.invalid"}))).status,403);
  assert.equal((await GET(request("GET",{token:""}))).status,401);
  assert.equal((await PUT(request("PUT",{actor:"merchant-b"}))).status,403);
  assert.equal((await GET(request("GET",{query:"?catalogImport=store-a&run=run-0001&run=run-0002"}))).status,400);
  assert.equal((await PUT(request("PUT",{body:{...manifest,actorId:"merchant-b"}}))).status,400);
  assert.deepEqual(calls,[]);
  let response=await PUT(request("PUT"));assert.equal(response.status,200);assert.deepEqual(await response.json(),{catalogImport:initial});
  response=await PATCH(request("PATCH"));assert.equal(response.status,200);assert.deepEqual(await response.json(),{catalogImport:complete});
  response=await GET(request("GET"));assert.equal(response.status,200);
  revoke=true;
  response=await GET(request("GET"));assert.equal(response.status,401);
  assert.deepEqual(calls,["PUT","PATCH","GET","GET"]);
});

const nodes=t=>Array.isArray(t)?t.flatMap(nodes):!t||typeof t!=="object"?[]:[t,...nodes(t.props?.children)];
const tick=()=>new Promise(setImmediate);
async function until(f){for(let i=0;i<120;i++){if(f())return;await tick();}assert.fail("UI did not settle");}
for(const os of ["web","android"])test("bulk import requires explicit confirmation and recovers one durable run after lost acknowledgments"+(os==="web"?"":" (Android)"),async()=>{
  const tmp=mkdtempSync(path.join(tmpdir(),"catalog-import-run-"));
  try{
    const root=path.resolve(import.meta.dirname,"../../..");
    const source=path.resolve(import.meta.dirname,"../src/features/catalog/catalog-import-run.tsx");
    const compiled=spawnSync(process.execPath,[path.join(root,"node_modules/typescript/bin/tsc"),source,"--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--outDir",tmp],{cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
    assert.equal(compiled.status,0,compiled.stderr||compiled.stdout);
    const code=readFileSync(path.join(tmp,"catalog-import-run.js"),"utf8");
    const storage=new Map(),calls=[];let states=[],refs=[],effects=[],si=0,ri=0,ei=0;
    const platform={OS:os};
    let digestGate=null,storageGate=null,storageWaiting=false,writeGate=null,writeWaiting=false;
    let ownerRun=null,ownerProcessed=0,refreshes=0,props={actorId,storeId,sourceSha256,onChanged(){refreshes++;},rows:[{row:2,name:"Milk",priceYer:"100",stockUnits:"2",reason:"existing-store-name",editableDraft:{id:"of-a",draftVersion:1}}]};
    const react={useState(initial){const i=si++;if(!(i in states))states[i]=initial;return [states[i],next=>{states[i]=typeof next==="function"?next(states[i]):next;}];},useRef(initial){const i=ri++;refs[i]??={current:initial};return refs[i];},useLayoutEffect(fn,deps){const i=ei++;const old=effects[i];if(!old||!deps||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();effects[i]={deps,cleanup:fn()};}}};
    const jsx=(type,props,key)=>({type,props:props??{},key});
    const get=k=>storage.get(k)??null,set=(k,v)=>storage.set(k,v),remove=k=>storage.delete(k);
    const mocks={"@bthwani/dsh":dsh,"@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},"expo-crypto":{randomUUID,CryptoDigestAlgorithm:{SHA256:"sha256"},digestStringAsync:async(alg,v)=>{if(digestGate&&v.startsWith("{"))await digestGate;return createHash(alg).update(v).digest("hex");}},"expo-secure-store":{WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async k=>{if(storageGate){storageWaiting=true;await storageGate;}return get(k);},setItemAsync:async(k,v)=>{if(writeGate){writeWaiting=true;await writeGate;}set(k,v);},deleteItemAsync:async k=>remove(k)},react,"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},"react-native":{Platform:platform,Pressable:"Pressable",Text:"Text",View:"View"},"./catalog-import-data":{buildImportManifest},"./catalog-import-transport":{async requestCatalogImport(a,s,r,m,signal,change){
      signal.throwIfAborted();assert.equal(a,actorId);assert.equal(s,storeId);calls.push({r,m,change});
      if(m==="PUT"){assert.equal(storage.size,1);assert.deepEqual(change,manifest);ownerRun=r;throw Error("lost start ack");}
      assert.equal(r,ownerRun);
      if(m==="PATCH"){ownerProcessed++;throw Error("lost progress ack");}
      return {...(ownerProcessed?complete:initial),runId:r};
    }}};
    const mod={exports:{}};
    new Function("require","module","exports","window",code)(n=>{assert.ok(Object.hasOwn(mocks,n),n);return mocks[n];},mod,mod.exports,{localStorage:{getItem:get,setItem:set,removeItem:remove},navigator:{locks:{async request(_key,fn){if(storageGate){storageWaiting=true;await storageGate;}return fn();}}}});
    const mixed=buildImportManifest([
      ...props.rows,
      {row:3,name:"x".repeat(6000),priceYer:"100",stockUnits:"2",reason:"invalid"},
      {row:4,name:"Extra columns",priceYer:"100",stockUnits:"2",reason:"invalid"},
    ],sourceSha256,new Set([2,3,4]));
    assert.ok(dsh.validMerchantCatalogImportChange(mixed),"bad minority rows must not block the valid selected row");
    assert.deepEqual(mixed.rows[0],manifest.rows[0]);
    assert.equal(mixed.rows[1].sourceIssue,"INVALID_ROW");
    assert.equal(mixed.rows[2].sourceIssue,"INVALID_ROW");
    assert.ok(mixed.rows.slice(1).every(r=>r.offerId===undefined&&r.expectedVersion===undefined));
    assert.equal(mixed.rows[2].name,"Extra columns");
    const render=()=>{si=ri=ei=0;return mod.exports.default(props);};
    const button=label=>nodes(render()).find(n=>n.type==="Pressable"&&nodes(n.props.children).some(x=>x.props?.children===label));
    const click=label=>{const b=button(label);assert.ok(b,label);assert.equal(Boolean(b.props.disabled),false,label);b.props.onPress();};
    const remount=()=>{for(const e of effects)e.cleanup?.();states=[];refs=[];effects=[];};
    render();await tick();
    assert.equal(button("اعتماد وتسجيل الدفعة المحددة").props.disabled,true);assert.equal(calls.length,0);
    const rowChoice=()=>nodes(render()).find(n=>n.props?.accessibilityLabel==="اعتماد السجل 2");
    assert.ok(rowChoice(),"each eligible row must be independently selectable");
    rowChoice().props.onPress();
    assert.equal(rowChoice().props.accessibilityState.checked,true);
    rowChoice().props.onPress();
    assert.equal(button("اعتماد وتسجيل الدفعة المحددة").props.disabled,true);
    click("تحديد جميع المسودات المطابقة");
    assert.equal(button("اعتماد وتسجيل الدفعة المحددة").props.disabled,false);
    const stalePreviewApproval=button("اعتماد وتسجيل الدفعة المحددة").props.onPress;
    props={...props,rows:[...props.rows]};
    render();
    assert.equal(button("اعتماد وتسجيل الدفعة المحددة").props.disabled,true,"a fresh owner preview of the same file must require fresh selection");
    stalePreviewApproval();
    await tick();
    assert.equal(calls.length,0,"a superseded preview callback must not register an import");
    assert.equal(storage.size,0,"a superseded preview callback must not persist a run");
    rowChoice().props.onPress();
    const staleSelectionApproval=button("اعتماد وتسجيل الدفعة المحددة").props.onPress;
    rowChoice().props.onPress();
    assert.equal(button("اعتماد وتسجيل الدفعة المحددة").props.disabled,true);
    staleSelectionApproval();
    await tick();
    assert.equal(calls.length,0,"a superseded selection callback must not register an import");
    assert.equal(storage.size,0,"a superseded selection callback must not persist a run");
    rowChoice().props.onPress();
    let releaseDigest;
    digestGate=new Promise(resolve=>{releaseDigest=resolve;});
    click("اعتماد وتسجيل الدفعة المحددة");
    props={...props,rows:[...props.rows]};
    render();
    releaseDigest();digestGate=null;
    await until(()=>!button("تحديد جميع المسودات المطابقة").props.disabled);
    assert.equal(calls.length,0,"preview replacement during fingerprinting must not dispatch");
    assert.equal(storage.size,0,"preview replacement during fingerprinting must not persist a run");
    rowChoice().props.onPress();
    let releaseStorage;
    storageGate=new Promise(resolve=>{releaseStorage=resolve;});
    click("اعتماد وتسجيل الدفعة المحددة");
    await until(()=>storageWaiting);
    props={...props,rows:[...props.rows]};
    render();
    releaseStorage();storageGate=null;
    await until(()=>!button("تحديد جميع المسودات المطابقة").props.disabled);
    assert.equal(calls.length,0,"preview replacement while acquiring recovery storage must not dispatch");
    assert.equal(storage.size,0,"preview replacement while acquiring recovery storage must not persist a run");
    if(os==="android"){
      rowChoice().props.onPress();
      let releaseWrite;
      writeGate=new Promise(resolve=>{releaseWrite=resolve;});
      click("اعتماد وتسجيل الدفعة المحددة");
      await until(()=>writeWaiting);
      props={...props,rows:[...props.rows]};
      render();
      releaseWrite();writeGate=null;
      await until(()=>!button("تحديد جميع المسودات المطابقة").props.disabled);
      assert.equal(calls.length,0,"preview replacement during durable write must not dispatch");
      assert.equal(storage.size,0,"undispatched attempt must not strand recovery");
    }
    rowChoice().props.onPress();click("اعتماد وتسجيل الدفعة المحددة");
    await until(()=>calls.length===1&&button("قراءة حالة الدفعة")&&!button("قراءة حالة الدفعة").props.disabled);
    const original=ownerRun;assert.equal(storage.size,1);
    remount();props={...props,rows:[],sourceSha256:""};render();
    await until(()=>button("قراءة حالة الدفعة")&&!button("قراءة حالة الدفعة").props.disabled);
    click("قراءة حالة الدفعة");await until(()=>button("تنفيذ أو استكمال الدفعة")&&!button("تنفيذ أو استكمال الدفعة").props.disabled);
    click("تنفيذ أو استكمال الدفعة");await until(()=>calls.some(c=>c.m==="PATCH")&&!button("قراءة حالة الدفعة").props.disabled);
    assert.equal(ownerProcessed,1);assert.equal(storage.size,1);
    click("قراءة حالة الدفعة");await until(()=>button("إنهاء متابعة الدفعة")&&!button("إنهاء متابعة الدفعة").props.disabled);
    assert.equal(button("تنفيذ أو استكمال الدفعة").props.disabled,true);
    click("إنهاء متابعة الدفعة");await until(()=>storage.size===0&&refreshes===1);
    assert.ok(calls.every(c=>c.r===original));assert.equal(calls.filter(c=>c.m==="PUT").length,1);assert.equal(calls.filter(c=>c.m==="PATCH").length,1);
    remount();
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
