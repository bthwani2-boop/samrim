import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { parseCommercialAgreementReview, readOperatorCommercialAgreementReview, readOwnedMerchantCommercialAgreementReview } from "./commercial-agreement.ts";

const proposal = {
  version: 2, operationId: "proposal-0002", storeRelation: "DIRECT", feeModel: "SUBSCRIPTION",
  collector: "STORE_MANAGED", currency: "YER", commissionBasisPoints: null,
  subscriptionAmountYer: "9007199254740993", subscriptionPeriodDays: 30,
  fulfillmentModes: ["CUSTOMER_PICKUP"], proposedEffectiveAt: "2027-01-01T00:00:00Z",
  reviewState: "REVIEW_APPROVED_PENDING_ACTIVATION",
};
test("review preserves exact terms and explicit absent proposal", () => {
  assert.deepEqual(parseCommercialAgreementReview({storeId:"store-a",proposal},"store-a"), {storeId:"store-a",proposal});
  assert.deepEqual(parseCommercialAgreementReview({storeId:"store-a",proposal:null},"store-a"), {storeId:"store-a",proposal:null});
  assert.deepEqual(parseCommercialAgreementReview({storeId:"store-a",proposal:{...proposal,feeModel:"COMMISSION",commissionBasisPoints:425,subscriptionAmountYer:null,subscriptionPeriodDays:null}},"store-a").proposal.commissionBasisPoints,425);
});
test("review rejects cross-store, active status, ambiguous amount and extra evidence", () => {
  for(const raw of [
    {storeId:"other",proposal},
    {storeId:"store-a",proposal:{...proposal,reviewState:"ACTIVE"}},
    {storeId:"store-a",proposal:{...proposal,subscriptionAmountYer:9007199254740992}},
    {storeId:"store-a",proposal:{...proposal,subscriptionAmountYer:"9223372036854775808"}},
    {storeId:"store-a",proposal:{...proposal,commissionBasisPoints:1}},
    {storeId:"store-a",proposal:{...proposal,fulfillmentModes:["CUSTOMER_PICKUP","CUSTOMER_PICKUP"]}},
    {storeId:"store-a",proposal:{...proposal,proposedEffectiveAt:"2027-02-30T00:00:00Z"}},
    {storeId:"store-a",proposal:{...proposal,actorId:"private"}},
  ]) assert.throws(()=>parseCommercialAgreementReview(raw,"store-a"));
});
test("SDK binds store ID to trusted origin and rejects path injection", async () => {
  await assert.rejects(()=>readOperatorCommercialAgreementReview("http://127.0.0.1:3203","x","../wallets/me",AbortSignal.timeout(1000)));
});
test("SDK performs a bound read, rejects denied or mismatched owner responses", async () => {
  const token=Buffer.alloc(32,9).toString("base64url");
  let status=200;
  let body={storeId:"store-a",proposal};
  const owner=createServer((req,res)=>{
    assert.equal(req.url,"/v1/operators/stores/store-a/commercial-agreement");
    assert.equal(req.headers.authorization,`Bearer ${token}`);
    res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve,reject)=>{owner.once("error",reject);owner.listen(0,"127.0.0.1",resolve);});
  try {
    const origin=`http://127.0.0.1:${owner.address().port}`;
    const read=()=>readOperatorCommercialAgreementReview(origin,token,"store-a",AbortSignal.timeout(1000));
    assert.deepEqual(await read(),body);
    body={...body,storeId:"other"};
    await assert.rejects(read);
    status=403;
    await assert.rejects(read,error=>error.status===403);
  } finally { await new Promise(resolve=>owner.close(resolve)); }
});
test("malformed financial terms never become accepted review data",()=>{
  for(const value of [
    null,[],{storeId:"store-a",proposal:[]},{storeId:"store-a",proposal,unexpected:true},
    ...[
      {version:0},{version:"2"},{operationId:"x"},{storeRelation:"UNKNOWN"},
      {feeModel:"HYBRID"},{collector:"OTHER"},{currency:"USD"},
      {proposedEffectiveAt:3},{proposedEffectiveAt:"bad"},
      {fulfillmentModes:null},{fulfillmentModes:[]},{fulfillmentModes:["UNKNOWN"]},
      {fulfillmentModes:["CUSTOMER_PICKUP","PARTNER_CAPTAIN","BTHWANI_CAPTAIN","UNKNOWN"]},
      {subscriptionAmountYer:"00"},{subscriptionPeriodDays:0},
      {feeModel:"COMMISSION",commissionBasisPoints:10001,subscriptionAmountYer:null,subscriptionPeriodDays:null},
      {feeModel:"COMMISSION",commissionBasisPoints:100,subscriptionAmountYer:null,subscriptionPeriodDays:30},
    ].map(change=>({storeId:"store-a",proposal:{...proposal,...change}})),
  ]) assert.throws(()=>parseCommercialAgreementReview(value,"store-a"));
});

test("Merchant SDK reads only the merchant-owned agreement route and rejects store substitution", async () => {
  const token=Buffer.alloc(32,9).toString("base64url");
  let status=200;
  let body={storeId:"store-a",proposal};
  const owner=createServer((req,res)=>{
    assert.equal(req.url,"/v1/merchants/stores/store-a/commercial-agreement");
    assert.equal(req.method,"GET");
    assert.equal(req.headers.authorization,`Bearer ${token}`);
    res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve,reject)=>{owner.once("error",reject);owner.listen(0,"127.0.0.1",resolve);});
  try {
    const origin=`http://127.0.0.1:${owner.address().port}`;
    const read=()=>readOwnedMerchantCommercialAgreementReview(origin,token,"store-a",AbortSignal.timeout(1000));
    assert.deepEqual(await read(),body);
    body={storeId:"store-a",proposal:null};
    assert.deepEqual(await read(),body);
    body={storeId:"other",proposal};
    await assert.rejects(read);
    status=403;
    await assert.rejects(read,error=>error.status===403);
    await assert.rejects(()=>readOwnedMerchantCommercialAgreementReview(origin,token,"../wallets/me",AbortSignal.timeout(1000)),error=>error.status===400);
  } finally { await new Promise(resolve=>owner.close(resolve)); }
});

test("all eight Store-relation, fee-model and collector combinations preserve explicit reviewed terms", () => {
  for (const storeRelation of ["DIRECT", "MARKETPLACE"]) {
    for (const feeModel of ["COMMISSION", "SUBSCRIPTION"]) {
      for (const collector of ["PLATFORM_MANAGED", "STORE_MANAGED"]) {
        const terms = { ...proposal, storeRelation, feeModel, collector,
          commissionBasisPoints: feeModel === "COMMISSION" ? 375 : null,
          subscriptionAmountYer: feeModel === "SUBSCRIPTION" ? "9007199254740993" : null,
          subscriptionPeriodDays: feeModel === "SUBSCRIPTION" ? 30 : null };
        assert.deepEqual(parseCommercialAgreementReview({ storeId: "store-a", proposal: terms }, "store-a").proposal, terms);
        const { collector: explicit, ...missing } = terms;
        assert.equal(explicit, collector);
        assert.throws(() => parseCommercialAgreementReview({ storeId: "store-a", proposal: missing }, "store-a"));
      }
    }
  }
});
