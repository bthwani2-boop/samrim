import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { readOwnedMerchantCommercialAgreementReview } from "./commercial-agreement.ts";
import { readCurrentCustomerOrderPaymentAllocation } from "./order-payment-readback.ts";

const token=Buffer.alloc(32,9).toString("base64url");
const origin="http://127.0.0.1:3203";
const agreement={storeId:"store-a",proposal:null};
const allocation={actorId:"wallet-one",checkoutId:"checkout-0001",allocation:null};
const opts={headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const readAgreement=s=>readOwnedMerchantCommercialAgreementReview(origin,token,"store-a",s);
const readAllocation=s=>readCurrentCustomerOrderPaymentAllocation(origin,token,"wallet-one","checkout-0001",s);
async function outcome(p){let timer;try{return await Promise.race([p.then(()=> "resolved",()=> "rejected"),new Promise(r=>{timer=setTimeout(()=>r("pending"),100);})]);}finally{clearTimeout(timer);}}
test("pre-cancelled read never dispatches bearer",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(agreement,opts);});
 const c=new AbortController();c.abort();
 assert.equal(await outcome(readAgreement(c.signal)),"rejected");assert.equal(calls,0);
});
test("cancelled allocation awaiting headers settles and discards late response",async t=>{
 const wait=deferred();let cancelled=0;
 t.mock.method(globalThis,"fetch",()=>wait.promise);
 const c=new AbortController();const pending=readAllocation(c.signal);
 await Promise.resolve();c.abort();
 const actual=await outcome(pending);
 wait.resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),opts));
 await new Promise(r=>setImmediate(r));
 assert.equal(actual,"rejected");assert.equal(cancelled,1);
});
test("cancelled agreement native text read settles before bridge reply",async t=>{
 const wait=deferred();const entered=deferred();
 t.mock.method(globalThis,"fetch",async()=>({status:200,headers:new Headers(opts.headers),body:null,text(){entered.resolve();return wait.promise;}}));
 const c=new AbortController();const pending=readAgreement(c.signal);
 await entered.promise;c.abort();
 const actual=await outcome(pending);wait.resolve(JSON.stringify(agreement));
 assert.equal(actual,"rejected");
});
test("cancelled stream releases reader and successor remains usable",async t=>{
 let cancel=0;const entered=deferred();const stream=new ReadableStream({pull(){entered.resolve();return new Promise(()=>{});},cancel(){cancel++;}});
 let count=0;t.mock.method(globalThis,"fetch",async()=>++count===1?new Response(stream,opts):Response.json(allocation,opts));
 const c=new AbortController();const pending=readAgreement(c.signal);
 await entered.promise;await Promise.resolve();c.abort();
 assert.equal(await outcome(pending),"rejected");
 await new Promise(r=>setImmediate(r));
 assert.equal(stream.locked,false);assert.equal(cancel,1);
 assert.deepEqual(await readAllocation(new AbortController().signal),allocation);
});
test("late rejected bridge and cancellation listener are released",async t=>{
 const wait=deferred();
 t.mock.method(globalThis,"fetch",()=>wait.promise);
 const c=new AbortController();const pending=readAllocation(c.signal);
 await Promise.resolve();c.abort();
 assert.equal(await outcome(pending),"rejected");
 assert.equal(getEventListeners(c.signal,"abort").length,0);
 wait.reject(new Error("late synthetic rejection"));
 await new Promise(r=>setImmediate(r));
});
test("real HTTP cancellation before headers permits a fresh read",async()=>{
 const entered=deferred();let requests=0;
 const server=createServer((req,res)=>{
  requests++;
  assert.equal(req.method,"GET");
  assert.equal(req.headers.authorization,"Bearer "+token);
  if(requests===1){entered.resolve();return;}
  res.writeHead(200,opts.headers);res.end(JSON.stringify(agreement));
 });
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const url="http://127.0.0.1:"+server.address().port;
 const read=s=>readOwnedMerchantCommercialAgreementReview(url,token,"store-a",s);
 try{
  const c=new AbortController();const pending=read(c.signal);
  await entered.promise;c.abort();
  assert.equal(await outcome(pending),"rejected");
  assert.deepEqual(await read(AbortSignal.timeout(1000)),agreement);
  assert.equal(requests,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});