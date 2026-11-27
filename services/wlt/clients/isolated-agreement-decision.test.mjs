import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import * as sdk from "./index.ts";

const token = Buffer.alloc(32, 9).toString("base64url");
const input = Object.freeze({ version: 2, proposalOperationId: "proposal-0002",
  operationId: "decision-0002", decision: "ACCEPTED", reason: "موافقة على الشروط" });
const origin = "http://127.0.0.1:3203";
const store = "store-a";
const receipt = { storeId: store, version: input.version, proposalOperationId: input.proposalOperationId,
  operationId: input.operationId, state: "RECORDED" };
const reply = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

test("isolated SDK exposes both exact decision routes, never retries automatically", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([String(url), options]);
    return reply({ ...receipt, state: calls.length === 1 ? "RECORDED" : "REPLAYED" });
  });
  assert.deepEqual(await sdk.recordIsolatedMerchantAgreementDecision(origin, token, store, input, new AbortController().signal), receipt);
  const finance = { ...input, decision: "FINANCE_APPROVED" };
  assert.equal((await sdk.recordIsolatedFinanceAgreementDecision(origin, token, store, finance, new AbortController().signal)).state, "REPLAYED");
  assert.deepEqual(calls.map(([url]) => url), [
    origin + "/v1/merchants/stores/store-a/commercial-agreement/decisions",
    origin + "/v1/operators/stores/store-a/commercial-agreement/decisions",
  ]);
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].redirect, "error");
  assert.equal(calls[0][1].headers.Authorization, "Bearer " + token);
  assert.deepEqual(JSON.parse(calls[0][1].body), input);
  assert.deepEqual(JSON.parse(calls[1][1].body), finance);
});

test("invalid local configuration, role, fields and pre-abort dispatch nothing", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => assert.fail("must not dispatch"));
  const signal = new AbortController().signal;
  for (const [host, bearer, id, body] of [
    ["http://10.0.2.2:3203",token,store,input], ["https://example.com",token,store,input],
    [origin,"invalid",store,input], [origin,token,"../store",input],
    [origin,token,store,{...input,version:0}], [origin,token,store,{...input,version:2.5}],
    [origin,token,store,{...input,reason:" "}], [origin,token,store,{...input,reason:"bad\nreason"}],
    [origin,token,store,{...input,decision:"FINANCE_APPROVED"}],
    [origin,token,store,{...input,actorId:"other"}], [origin,token,store,{...input,operationId:"short"}],
  ]) await assert.rejects(sdk.recordIsolatedMerchantAgreementDecision(host,bearer,id,body,signal));
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(sdk.recordIsolatedMerchantAgreementDecision(origin,token,store,input,stopped.signal));
  assert.equal(request.mock.callCount(),0);
});

test("exact owner receipt is mandatory; malformed or ambiguous outcome requires same identity", async t => {
  for (const bad of [
    {...receipt,storeId:"store-b"}, {...receipt,version:3}, {...receipt,proposalOperationId:"proposal-0003"},
    {...receipt,operationId:"decision-0003"}, {...receipt,state:"ACTIVE"}, {...receipt,extra:true},
  ]) {
    t.mock.method(globalThis,"fetch",async()=>reply(bad));
    await assert.rejects(sdk.recordIsolatedMerchantAgreementDecision(origin,token,store,input,new AbortController().signal),
      e => e.outcome === "UNCONFIRMED" && e.status === 503);
    t.mock.restoreAll();
  }
  for(const [status,code] of [[400,"INVALID_REQUEST"],[401,"UNAUTHORIZED"],[403,"FORBIDDEN"],[409,"DECISION_CONFLICT"]]){
    t.mock.method(globalThis,"fetch",async()=>reply({error:code},status));
    await assert.rejects(sdk.recordIsolatedMerchantAgreementDecision(origin,token,store,input,new AbortController().signal),
      e=>e.outcome==="REJECTED" && e.status===status);
    t.mock.restoreAll();
  }
  for (const value of [reply({error:"OTHER"},409),reply({error:"DECISION_UNCONFIRMED"},503),
    new Response(JSON.stringify({error:"DECISION_CONFLICT"}),{status:409})]){
    t.mock.method(globalThis,"fetch",async()=>value);
    await assert.rejects(sdk.recordIsolatedMerchantAgreementDecision(origin,token,store,input,new AbortController().signal),
      e=>e.outcome==="UNCONFIRMED");
    t.mock.restoreAll();
  }
});

test("real loopback HTTP loss after dispatch is unconfirmed; same operation can be replayed", async () => {
  const requests = [];
  const server = createServer((req,res)=>{
    let body="";req.setEncoding("utf8");req.on("data",chunk=>body+=chunk);
    req.on("end",()=>{
      requests.push({path:req.url,body:JSON.parse(body)});
      if(requests.length===1){res.destroy();return;}
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({...receipt,state:"REPLAYED"}));
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address="http://127.0.0.1:"+server.address().port;
    await assert.rejects(sdk.recordIsolatedMerchantAgreementDecision(address,token,store,input,new AbortController().signal),
      e=>e.outcome==="UNCONFIRMED");
    assert.equal(requests.length,1);
    assert.equal((await sdk.recordIsolatedMerchantAgreementDecision(address,token,store,input,new AbortController().signal)).state,"REPLAYED");
    assert.equal(requests.length,2);
    assert.deepEqual(requests[0],requests[1]);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test("cancelling a dispatched decision is unconfirmed and a detached reply never succeeds", async t => {
  const controller = new AbortController();
  let resolveLate, observedSignal;
  const entered = new Promise(resolve => {
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      observedSignal = options.signal;
      resolve();
      return new Promise(done => { resolveLate = done; });
    });
  });
  const pending = sdk.recordIsolatedMerchantAgreementDecision(origin,token,store,input,controller.signal);
  await entered;
  controller.abort();
  await assert.rejects(pending,e=>e.outcome==="UNCONFIRMED"&&e.status===503);
  assert.equal(observedSignal.aborted,true);
  let cancelled = false;
  resolveLate(new Response(new ReadableStream({cancel(){cancelled=true;}}),{
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  }));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,true);
  assert.equal(globalThis.fetch.mock.callCount(),1);
});
