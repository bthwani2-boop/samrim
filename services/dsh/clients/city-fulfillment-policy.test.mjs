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
