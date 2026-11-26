import assert from "node:assert/strict";
import { test } from "node:test";
import { getCityFulfillmentPolicy, replaceCityFulfillmentPolicy } from "./city-policies.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 9).toString("base64url");
const base = { cityId: "sanaa", relation: "DIRECT", version: 0, allowedModes: [] };
const change = { operationId: "fulfillment-policy-001", expectedVersion: 0,
  allowedModes: ["CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"], reason: "Explicit permitted methods" };
const committed = { ...base, version: 1, allowedModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"],
  changedByActor: "operator-a", reason: change.reason, updatedAt: "2026-11-26T12:00:00Z" };

test("fulfillment policy client uses exact owner scope and rejects forged versions/modes", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let body = base;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), origin + "/v1/operators/cities/sanaa/fulfillment-policy/DIRECT");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer " + bearer);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  };
  try {
    assert.deepEqual(await getCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer), base);
    body = { ...base, allowedModes: ["CUSTOMER_PICKUP"] };
    await assert.rejects(getCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer));
    body = { ...base, relation: "MARKETPLACE" };
    await assert.rejects(getCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer));
    body = { policy: committed, replay: false };
    assert.deepEqual(await replaceCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer, change), body);
    body = { policy: { ...committed, allowedModes: ["PARTNER_CAPTAIN"] }, replay: false };
    await assert.rejects(replaceCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer, change));
    await assert.rejects(replaceCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer, { ...change, allowedModes: ["CUSTOMER_PICKUP","CUSTOMER_PICKUP"] }));
    await assert.rejects(replaceCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer, { ...change, allowedModes: null }));
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
});

test("all city-policy commands bind the response to the exact submitted values, not later caller mutations", async t => {
  const { previewCityDeliveryPolicy, replaceCityDeliveryPolicy, replaceCityStoreOperationalPolicy } = await import("./city-policies.ts");
  const stamp = "2026-11-26T12:00:00Z";
  const cases = [
    {
      input: structuredClone(change),
      invoke: input => replaceCityFulfillmentPolicy(origin, "sanaa", "DIRECT", bearer, input),
      reply: { policy: committed, replay: false },
      mutate: input => { input.allowedModes.push("PARTNER_CAPTAIN"); input.expectedVersion = 9; input.reason = "later"; },
      forged: { policy: { ...committed, version: 10, reason: "later", allowedModes: ["BTHWANI_CAPTAIN","PARTNER_CAPTAIN","CUSTOMER_PICKUP"] }, replay: false },
    },
    {
      input: { operationId: "city-store-001", expectedVersion: 1, maxPauseSeconds: 900, maxPreparationMinutes: 30, reason: "before" },
      invoke: input => replaceCityStoreOperationalPolicy(origin, "sanaa", bearer, input),
      reply: { policy: { cityId:"sanaa",version:2,maxPauseSeconds:900,maxPreparationMinutes:30,changedByActor:"operator-a",changeReason:"before",updatedAt:stamp }, replay:false },
      mutate: input => { input.expectedVersion=4; input.maxPauseSeconds=1200; input.maxPreparationMinutes=45; input.reason="later"; },
      forged: { policy: { cityId:"sanaa",version:5,maxPauseSeconds:1200,maxPreparationMinutes:45,changedByActor:"operator-a",changeReason:"later",updatedAt:stamp },replay:false },
    },
    {
      input: { operationId:"city-delivery-001",expectedVersion:2,radiusMetres:20000,distanceBands:[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}],reason:"before" },
      invoke: input => replaceCityDeliveryPolicy(origin,"sanaa",bearer,input),
      reply: { policy:{cityId:"sanaa",version:3,radiusMetres:20000,distanceBands:[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}],updatedAt:stamp},replay:false },
      mutate: input => { input.expectedVersion=6; input.radiusMetres=30000; input.distanceBands[0].ratePerKmMinor=600; input.distanceBands[1].ratePerKmMinor=500; },
      forged: { policy:{cityId:"sanaa",version:7,radiusMetres:30000,distanceBands:[{upToMeters:2000,ratePerKmMinor:600},{upToMeters:null,ratePerKmMinor:500}],updatedAt:stamp},replay:false },
    },
    {
      input: { expectedVersion:2,radiusMetres:20000,distanceMetres:2001,distanceBands:[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}] },
      invoke: input => previewCityDeliveryPolicy(origin,"sanaa",bearer,input),
      reply: { cityId:"sanaa",version:2,radiusMetres:20000,distanceMetres:2001,feeYer:"601",payable:false },
      mutate: input => { input.expectedVersion=6; input.radiusMetres=30000; input.distanceMetres=4000; input.distanceBands[0].ratePerKmMinor=600; },
      forged: { cityId:"sanaa",version:6,radiusMetres:30000,distanceMetres:4000,feeYer:"1200",payable:false },
    },
  ];
  let dispatch;
  const spy = t.mock.method(globalThis, "fetch", (_url, init) => dispatch(init));
  for (const item of cases) {
    for (const response of [item.reply,item.forged]) {
      const caller = structuredClone(item.input);
      let finish;
      dispatch = init => {
        assert.deepEqual(JSON.parse(init.body),item.input);
        return new Promise(resolve => { finish = resolve; });
      };
      const pending = item.invoke(caller);
      assert.equal(typeof finish,"function","request must already be dispatched");
      item.mutate(caller);
      finish(Response.json(response,{headers:{"Cache-Control":"no-store"}}));
      if (response === item.reply) assert.deepEqual(await pending,item.reply);
      else await assert.rejects(pending,{status:502});
    }
  }
  assert.equal(spy.mock.callCount(),8,"no implicit retry after unknown outcome");
});
