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
const proposal = Object.freeze({
  expectedVersion: 0, operationId: "proposal-0001", feeModel: "SUBSCRIPTION", collector: "STORE_MANAGED",
  subscriptionAmountYer: "9007199254740993", subscriptionPeriodDays: 30, fulfillmentModes: ["CUSTOMER_PICKUP"],
  proposedEffectiveAt: "2027-01-01T10:00:00.000001+03:00", reason: "مقترح اشتراك",
});
const proposed = { storeId: store, version: 1, operationId: proposal.operationId, state: "RECORDED" };

test("Finance proposal sends exact terms and verifies receipt against the next version", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => reply(proposed));
  const signal = new AbortController().signal;
  assert.deepEqual(await sdk.recordIsolatedFinanceAgreementProposal(origin, token, store, proposal, signal), proposed);
  const { arguments: [url, options] } = request.mock.calls[0];
  assert.equal(String(url), origin + "/v1/operators/stores/store-a/commercial-agreement/proposals");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), proposal);

  const { subscriptionAmountYer, subscriptionPeriodDays, ...common } = proposal;
  const commission = { ...common, feeModel: "COMMISSION", commissionBasisPoints: 0 };
  assert.deepEqual(await sdk.recordIsolatedFinanceAgreementProposal(origin, token, store, commission, signal), proposed);
  assert.deepEqual(JSON.parse(request.mock.calls[1].arguments[1].body), commission);
});

test("invalid Finance proposal terms and pre-aborted requests dispatch nothing", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => assert.fail("must not dispatch"));
  const signal = new AbortController().signal;
  const changes = [
    { expectedVersion: Number.MAX_SAFE_INTEGER }, { expectedVersion: -1 }, { operationId: "short" },
    { subscriptionAmountYer: "9223372036854775808" }, { subscriptionAmountYer: 9007199254740992 },
    { subscriptionAmountYer: "01" }, { subscriptionPeriodDays: 2147483648 }, { commissionBasisPoints: 0 },
    { fulfillmentModes: ["CUSTOMER_PICKUP", "CUSTOMER_PICKUP"] }, { fulfillmentModes: Array(1) },
    { proposedEffectiveAt: "2027-02-30T10:00:00Z" }, { proposedEffectiveAt: "2027-01-01T10:00:00.0000001Z" },
    { proposedEffectiveAt: "9999-12-31T23:59:59-01:00" }, { proposedEffectiveAt: "0001-01-01T01:00:00+01:00" },
    { collector: "OTHER" }, { storeRelation: "DIRECT" }, { reason: "مقترح\nملغى" },
  ];
  for (const change of changes) {
    await assert.rejects(sdk.recordIsolatedFinanceAgreementProposal(origin, token, store, { ...proposal, ...change }, signal),
      error => error instanceof sdk.WltProposalError && error.outcome === "NOT_SENT" && error.status === 400);
  }
  const { subscriptionAmountYer, ...rest } = proposal;
  const inheritedAmount = Object.assign(Object.create({ subscriptionAmountYer }), rest);
  await assert.rejects(sdk.recordIsolatedFinanceAgreementProposal(origin, token, store, inheritedAmount, signal),
    error => error.outcome === "NOT_SENT");
  await assert.rejects(sdk.recordIsolatedFinanceAgreementProposal(origin, token, store, proposal, AbortSignal.abort()),
    error => error.outcome === "NOT_SENT");
  assert.equal(request.mock.callCount(), 0);
});

test("Finance proposal distinguishes the owner rejection from mismatched or unknown results", async t => {
  const signal = new AbortController().signal;
  for (const [value, status, outcome] of [
    [{ error: "PROPOSAL_CONFLICT" }, 409, "REJECTED"],
    [{ error: "FORBIDDEN" }, 403, "REJECTED"],
    [{ error: "DECISION_CONFLICT" }, 409, "UNCONFIRMED"],
    [{ error: "PROPOSAL_UNCONFIRMED" }, 503, "UNCONFIRMED"],
    [{ ...proposed, storeId: "store-b" }, 200, "UNCONFIRMED"],
    [{ ...proposed, version: 2 }, 200, "UNCONFIRMED"],
    [{ ...proposed, operationId: "proposal-0002" }, 200, "UNCONFIRMED"],
    [{ ...proposed, state: "ACTIVE" }, 200, "UNCONFIRMED"],
    [{ ...proposed, extra: true }, 200, "UNCONFIRMED"],
  ]) {
    t.mock.method(globalThis, "fetch", async () => reply(value, status));
    await assert.rejects(sdk.recordIsolatedFinanceAgreementProposal(origin, token, store, proposal, signal),
      error => error instanceof sdk.WltProposalError && error.outcome === outcome);
    t.mock.restoreAll();
  }
});

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

for (const [label, send, terms, saved] of [
  ["decision", sdk.recordIsolatedMerchantAgreementDecision, input, receipt],
  ["proposal", sdk.recordIsolatedFinanceAgreementProposal, proposal, proposed],
]) test("real loopback loss leaves the " + label + " unconfirmed and permits replay of the same operation", async () => {
  const requests = [];
  const server = createServer((req,res)=>{
    let body="";req.setEncoding("utf8");req.on("data",chunk=>body+=chunk);
    req.on("end",()=>{
      requests.push({path:req.url,body:JSON.parse(body)});
      if(requests.length===1){res.destroy();return;}
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({...saved,state:"REPLAYED"}));
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address="http://127.0.0.1:"+server.address().port;
    await assert.rejects(send(address,token,store,terms,new AbortController().signal),
      e=>e.outcome==="UNCONFIRMED");
    assert.equal(requests.length,1);
    assert.equal((await send(address,token,store,terms,new AbortController().signal)).state,"REPLAYED");
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
