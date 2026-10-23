#!/usr/bin/env node
// Local provider-neutral simulator control. No wallet ledger mutations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = process.env.PAYMENT_MOCK_URL ?? "http://127.0.0.1:18090";
const url = new URL(base);
if (url.protocol !== "http:" || !["127.0.0.1","localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Mock admin URL must be loopback only");
const validProvider = /^wallet_provider_[a-z0-9_]{2,60}$/;
const alpha="wallet_provider_test_alpha";
const beta="wallet_provider_test_beta";
const supported=new Set(["success","failure","unknown","delayed","http500","timeout","invalid","reset","check"]);
const mode=(process.argv[2] ?? "check").toLowerCase();
const provider=(process.argv[3] ?? alpha).toLowerCase();
if (!supported.has(mode) || (mode !== "check" && !validProvider.test(provider))) throw new Error("Usage: node tools/dev/payment-provider-mock.mjs <check|success|failure|unknown|delayed|http500|timeout|invalid|reset> [providerKey]");
const providerURL=(key)=>base+"/v1/providers/"+key+"/payments";
const ref=(key,id)=>"WM-"+key+"-"+id;
function scenarioId(key) {
  const hex=createHash("sha256").update("bthwani-local-mock:"+key).digest("hex");
  return hex.slice(0,8)+"-"+hex.slice(8,12)+"-4"+hex.slice(13,16)+"-8"+hex.slice(17,20)+"-"+hex.slice(20,32);
}
function scenarioMapping(name,key) {
  const path="/v1/providers/"+key+"/payments/WM-"+key+"-.+";
  const reference="{{request.pathSegments.[4]}}";
  const response=name==="http500" ? {status:503,body:"provider unavailable"} :
    name==="timeout" ? {status:200,fixedDelayMilliseconds:5000,body:"{}"} :
    name==="invalid" ? {status:200,body:"not-json"} : {
      status:200,body:JSON.stringify({
        providerKey:key,providerReference:reference,outcome:name.toUpperCase(),
        providerTransactionReference:name==="success"?"WM-TXN-"+reference:"",
        providerFeeMinor:name==="success"?37:0
      })
    };
  return {id:scenarioId(key),priority:1,request:{method:"GET",urlPathPattern:path},response:{...response,headers:{"Content-Type":"application/json"}}};
}
async function switchTo(name,key) {
  const id=scenarioId(key);
  if(name==="reset"){
    const response=await fetch(base+"/__admin/mappings/"+id,{method:"DELETE",signal:AbortSignal.timeout(4000)});
    if(!response.ok && response.status!==404)throw new Error("Mock reset HTTP "+response.status);
    return;
  }
  const data=JSON.stringify(scenarioMapping(name,key));
  const check=await fetch(base+"/__admin/mappings/"+id,{signal:AbortSignal.timeout(4000)});
  const result=await fetch(base+"/__admin/mappings"+(check.ok?"/"+id:""),{method:check.ok?"PUT":"POST",headers:{"Content-Type":"application/json"},body:data,signal:AbortSignal.timeout(4000)});
  if(!result.ok)throw new Error("Mock scenario HTTP "+result.status+": "+(await result.text()).slice(0,180));
}
async function create(key,externalReference) {
 const response=await fetch(providerURL(key),{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":externalReference},body:JSON.stringify({intentId:"contract-"+externalReference,externalReference,amountMinor:10000,currency:"YER"}),signal:AbortSignal.timeout(4000)});
 assert.equal(response.status,201);
 const result=await response.json();
 assert.deepEqual(result,{providerKey:key,providerReference:ref(key,externalReference),state:"PENDING_PROVIDER"});
 return result.providerReference;
}
async function inquiry(key,reference,expected,{status=200,timeout=4000}={}) {
 const response=await fetch(providerURL(key)+"/"+encodeURIComponent(reference),{signal:AbortSignal.timeout(timeout)});
 assert.equal(response.status,status);
 if(!expected)return;
 const result=await response.json();
 assert.equal(result.providerKey,key);
 assert.equal(result.providerReference,reference);
 assert.equal(result.outcome,expected);
 assert.equal(result.providerFeeMinor,expected==="SUCCESS"?37:0);
 assert.equal(result.providerTransactionReference,expected==="SUCCESS"?"WM-TXN-"+reference:"");
}
async function check(){
 const id="check-"+Date.now();
 const a=await create(alpha,id),b=await create(beta,id);
 assert.notEqual(a,b,"provider references must remain distinct");
 assert.equal(await create(alpha,id),a,"create retry must be stable");
 try{
   await inquiry(alpha,a,"SUCCESS");
   await inquiry(beta,b,"SUCCESS");
   for(const state of ["failure","unknown","delayed","success"]){
     await switchTo(state,alpha);
     await inquiry(alpha,a,state.toUpperCase());
     await inquiry(beta,b,"SUCCESS");
     console.log("PASS independent provider scenario",state);
   }
   await switchTo("http500",alpha);
   await inquiry(alpha,a,null,{status:503});
   await switchTo("invalid",alpha);
   const invalid=await fetch(providerURL(alpha)+"/"+a);
   assert.equal(await invalid.text(),"not-json");
   await switchTo("timeout",alpha);
   let timedOut=false;try{await inquiry(alpha,a,null,{timeout:700});}catch(e){timedOut=e?.name==="TimeoutError";}
   assert.equal(timedOut,true,"timeout scenario did not delay provider");
   console.log("PASS isolated provider failure, invalid response, timeout");
   console.log("PAYMENT_PROVIDER_MOCK_CONTRACT=PASS");
 }finally{await switchTo("reset",alpha);await switchTo("reset",beta);}
}
if(mode==="check")await check();else{
 await switchTo(mode,provider);
 console.log("LOCAL_PAYMENT_PROVIDER_MOCK",mode,provider);
}
