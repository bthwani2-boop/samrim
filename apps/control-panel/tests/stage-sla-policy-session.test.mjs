import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source=readFileSync(path.resolve(import.meta.dirname,"../src/features/policies/stage-sla-policies-workspace.tsx"),"utf8");
const from=source.indexOf(" async function approve(){");
const to=source.indexOf("\n return <section",from);
assert.ok(from>0&&to>from,"extract the actual Stage SLA approval function");
const code=source.slice(from,to)
 .replace(" as {policy?:Policy;error?:{message?:string;code?:string}}","")
 .replace("const body:unknown=await read.json();","const body=await read.json();");
const approved={fulfillmentMode:"BTHWANI_CAPTAIN",stage:"PREPARING",targetMinutes:45,
 warningMinutes:10,version:2,effectiveAt:"2026-11-08T14:00:00Z"};
const response=value=>({ok:true,json:async()=>value});
const shortSignal=duration=>({
 any:signals=>AbortSignal.any(signals),
 timeout:ms=>{assert.equal(ms,duration);return AbortSignal.timeout(8);}
});
function runApproval(fetchImpl,{ready=true,signalAPI=shortSignal(20_000)}={}){
 const calls=[],inFlightSave={current:null};
 const changes={busy:[],errors:[],notices:[],ready:[],policies:[]};
 const run=runInNewContext(code+"\n({first:approve(),again:approve})",{
  authorized:true,readReady:ready,valid:true,saving:false,inFlightSave,
  window:{confirm:()=>true},AbortController,AbortSignal:signalAPI,
  mode:"BTHWANI_CAPTAIN",stage:"PREPARING",targetValue:45,warningValue:10,
  selected:{version:1},crypto:{randomUUID:()=>"one-key"},
  fetch:(...args)=>{calls.push(args);return fetchImpl(...args);},
  validPolicies:items=>Array.isArray(items)&&items.every(x=>Number.isSafeInteger(x.version)),
  setSaving:value=>changes.busy.push(value),
  setPolicies:value=>changes.policies.push(value),
  setReadReady:value=>changes.ready.push(value),
  setNotice:value=>changes.notices.push(value),
  setError:value=>changes.errors.push(value),
 });
 return {...run,calls,changes,inFlightSave};
}
test("Stage SLA policy is remounted with role, permissions and complete session",()=>{
 assert.match(source,/state\.identity\.role!=="operator"/);
 assert.match(source,/!state\.identity\.subject\|\|!state\.identity\.sessionId/);
 assert.match(source,/\.\.\.\(state\.identity\.permissions\?\?\[\]\)\]\.sort\(\)/);
 assert.match(source,/<StageSLAPolicyEditor key=\{key\}/);
 assert.match(source,/inFlightSave\.current\?\.abort\(\)/);
 assert.match(source,/disabled=\{!readReady\|\|!valid\|\|saving\}/);
 assert.match(source,/setRefresh\(n=>n\+1\)/);
});
test("successful Stage SLA POST requires matching canonical owner readback",async()=>{
 const run=runApproval((_url,options)=>options.method==="POST"?
  response({policy:approved}):response({items:[approved]}));
 await run.first;
 assert.equal(run.calls.length,2);
 assert.equal(run.calls[0][1].method,"POST");
 assert.equal(JSON.parse(run.calls[0][1].body).expectedVersion,1);
 assert.strictEqual(run.calls[0][1].signal,run.calls[1][1].signal);
 assert.match(run.changes.notices.at(-1),/مثبت بقراءة DSH/);
 assert.equal(run.changes.busy.at(-1),false);
 assert.equal(run.inFlightSave.current,null);
});
test("stalled POST times out and cannot be retried from the same stale render",async()=>{
 const run=runApproval((_url,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
 }));
 await run.first;
 assert.equal(run.calls.length,1);
 assert.equal(run.calls[0][1].signal.aborted,true);
 assert.equal(run.changes.ready.at(-1),false);
 assert.equal(run.changes.busy.at(-1),false);
 assert.match(run.changes.errors.at(-1),/أعد قراءة المهل من DSH/);
 assert.ok(run.inFlightSave.current,"ambiguous outcome must retain the no-retry gate");
 await run.again();
 assert.equal(run.calls.length,1,"do not dispatch a second POST before fresh DSH GET");
});
test("matching POST but mismatched DSH canonical GET fails closed",async()=>{
 const changed={...approved,version:3};
 const run=runApproval((_url,options)=>options.method==="POST"?
  response({policy:approved}):response({items:[changed]}));
 await run.first;
 assert.equal(run.calls.length,2);
 assert.equal(run.calls.filter(([,opt])=>opt.method==="POST").length,1);
 assert.equal(run.changes.ready.at(-1),false);
 assert.equal(run.changes.notices.at(-1),"");
 assert.deepEqual(Array.from(run.changes.policies.at(-1)),[]);
 assert.ok(run.inFlightSave.current);
});
test("old session cancellation suppresses late POST and never starts old owner GET",async()=>{
 let deliver;
 const blocked=new Promise(resolve=>{deliver=resolve;});
 const run=runApproval(()=>blocked);
 assert.equal(run.calls.length,1);
 run.inFlightSave.current.abort();
 deliver(response({policy:approved}));
 await run.first;
 assert.equal(run.calls.length,1);
 assert.deepEqual(run.changes.notices,[""]);
 assert.deepEqual(run.changes.ready,[]);
});
test("missing DSH readback prevents any new Stage SLA POST",async()=>{
 const run=runApproval(()=>{throw Error("POST should not start")},{ready:false});
 await run.first;
 assert.equal(run.calls.length,0);
});

const guardStart=source.indexOf("function validPolicies(value:unknown):value is Policy[]{");
const guardEnd=source.indexOf("\nexport function StageSLAPoliciesWorkspace()",guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart);
const guardCode=source.slice(guardStart,guardEnd)
 .replace("value:unknown):value is Policy[]","value)")
 .replace("const keys=new Set<string>();","const keys=new Set();")
 .replace("(item:unknown)","(item)")
 .replace("const p=item as Policy;","const p=item;");
const modes=[["BTHWANI_CAPTAIN"],["PARTNER_CAPTAIN"],["CUSTOMER_PICKUP"]];
const stages=[["CREATED"],["PREPARING"],["READY_FOR_PICKUP"]];
const validPolicies=runInNewContext(guardCode+"\nvalidPolicies",{
 modes,stages,allowed:(mode,stage)=>stage!=="READY_FOR_PICKUP"||mode==="CUSTOMER_PICKUP"
});
test("canonical Stage SLA GET rejects malformed policy amounts, versions, duplicate keys and invalid stage",()=>{
 const current={...approved,version:1};
 assert.equal(validPolicies([current]),true);
 for(const changed of [
  {targetMinutes:0},{targetMinutes:"45"},{warningMinutes:45},{warningMinutes:-1},
  {version:0},{version:1.5},{fulfillmentMode:"OTHER"},{stage:"INVALID"},
  {fulfillmentMode:"PARTNER_CAPTAIN",stage:"READY_FOR_PICKUP"},{effectiveAt:12}
 ]){
  assert.equal(validPolicies([{...current,...changed}]),false,JSON.stringify(changed));
 }
 assert.equal(validPolicies([current,{...current,version:2}]),false);
 assert.equal(validPolicies(Array.from({length:22},(_,i)=>({...current,stage:"CREATED",version:i+1}))),false);
 assert.equal(validPolicies(null),false);
});

const effectStart=source.indexOf(" useEffect(()=>{\n  const controller=new AbortController();");
const effectEnd=source.indexOf(" },[authorized,refresh]);",effectStart);
assert.ok(effectStart>=0&&effectEnd>effectStart);
const effectCode=source.slice(effectStart,effectEnd+" },[authorized,refresh]);".length)
 .replace("const body:unknown=await res.json();","const body=await res.json();");
function runRead(fetchImpl){
 const inFlightSave={current:new AbortController()};
 let cleanup;
 const state={loading:[],ready:[],policies:[],errors:[],notices:[]};
 runInNewContext(effectCode,{
  useEffect:callback=>{cleanup=callback();},
  AbortController,AbortSignal:{
   any:signals=>AbortSignal.any(signals),
   timeout:ms=>{assert.equal(ms,12_000);return AbortSignal.timeout(8);}
  },authorized:true,refresh:0,inFlightSave,validPolicies,
  fetch:fetchImpl,
  setLoading:x=>state.loading.push(x),
  setReadReady:x=>state.ready.push(x),
  setPolicies:x=>state.policies.push(x),
  setError:x=>state.errors.push(x),
  setNotice:x=>state.notices.push(x),
 });
 return {state,cleanup,inFlightSave};
}
test("stalled Stage SLA policy GET stays fail-closed and offers recovery",async()=>{
 const run=runRead((_url,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
 }));
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(run.state.loading.at(-1),false);
 assert.equal(run.state.ready.at(-1),false);
 assert.deepEqual(Array.from(run.state.policies.at(-1)),[]);
 assert.match(run.state.errors.at(-1),/تعذر الاتصال|TimeoutError|timed out|timeout|signal/);
 assert.ok(run.inFlightSave.current,"a failed read must not release a prior uncertain mutation");
 run.cleanup();
});
test("fresh canonical Stage SLA GET clears the previous uncertain mutation no-retry gate",async()=>{
 const run=runRead(async()=>response({items:[{...approved,version:1}]}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(run.state.ready.at(-1),true);
 assert.equal(run.state.loading.at(-1),false);
 assert.equal(run.state.policies.at(-1)[0].version,1);
 assert.equal(run.inFlightSave.current,null);
 run.cleanup();
});

test("Stage SLA canonical policy update refreshes inputs without erasing confirmed save notice",()=>{
 const a=source.indexOf(" useEffect(()=>{\n  // Refresh numeric fields");
 const b=source.indexOf("\n const targetValue=",a);
 assert.ok(a>0&&b>a);
 const effects=[],changes={target:[],warning:[],error:[],notice:[]};
 runInNewContext(source.slice(a,b),{
  selected:approved,mode:"BTHWANI_CAPTAIN",stage:"PREPARING",
  useEffect:(callback,deps)=>effects.push({callback,deps}),
  setTarget:x=>changes.target.push(x),setWarning:x=>changes.warning.push(x),
  setError:x=>changes.error.push(x),setNotice:x=>changes.notice.push(x),
 });
 assert.equal(effects.length,2);
 assert.equal(effects[0].deps.length,3,"canonical selection should refresh numeric inputs");
 assert.equal(effects[1].deps.length,2,"confirmation should reset only on user's mode/stage change");
 effects[0].callback();
 assert.deepEqual(changes.target,["45"]);
 assert.deepEqual(changes.warning,["10"]);
 assert.deepEqual(changes.notice,[],"successful canonical readback must retain the save notice");
});
