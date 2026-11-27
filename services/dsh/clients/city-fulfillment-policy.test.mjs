import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCityDeliveryPolicy,
  getCityFulfillmentPolicy,
  getCityStoreOperationalPolicy,
  listCityStoreOperationalPolicyHistory,
  previewCityDeliveryPolicy,
  replaceCityDeliveryPolicy,
  replaceCityFulfillmentPolicy,
  replaceCityStoreOperationalPolicy,
} from "./city-policies.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 9).toString("base64url");
const city = "sanaa";
const stamp = "2026-11-26T12:00:00Z";
const base = { cityId: city, relation: "DIRECT", version: 0, allowedModes: [] };
const change = { operationId: "fulfillment-policy-001", expectedVersion: 0,
  allowedModes: ["CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"], reason: "Explicit permitted methods" };
const committed = { ...base, version: 1, allowedModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"],
  changedByActor: "operator-a", reason: change.reason, updatedAt: stamp };
const store = { cityId: city, version: 1, maxPauseSeconds: 900, maxPreparationMinutes: 30,
  changedByActor: "operator-a", changeReason: "reviewed", updatedAt: stamp };
const delivery = { cityId: city, version: 1, radiusMetres: 20000, updatedAt: stamp,
  distanceBands: [{ upToMeters: null, ratePerKmMinor: 100 }] };
const bands = [{ upToMeters: 2000, ratePerKmMinor: 300 }, { upToMeters: null, ratePerKmMinor: 200 }];
const readInvalid = { status: 502, code: "OWNER_RESPONSE_INVALID" };
const writeUnknown = { status: 502, code: "OPERATION_RESULT_UNKNOWN" };
const invalidChange = { status: 400, code: "INVALID_OPERATIONAL_CHANGE" };
const reply = body => Response.json(body, { headers: { "Cache-Control": "no-store" } });
const receipt = (policy, replay = false) => ({ policy, replay });
const readFulfillment = signal => getCityFulfillmentPolicy(origin, city, "DIRECT", bearer, signal);
const writeFulfillment = (input, signal) => replaceCityFulfillmentPolicy(origin, city, "DIRECT", bearer, input, signal);

test("fulfillment owner scope, empty initial policy, exact receipt and local admission", async t => {
  let body = base;
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), origin + "/v1/operators/cities/sanaa/fulfillment-policy/DIRECT");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer " + bearer);
    assert.equal(init.method, body.policy ? "PATCH" : "GET");
    if (body.policy) assert.deepEqual(JSON.parse(init.body), change);
    return reply(body);
  });
  assert.deepEqual(await readFulfillment(), base);
  for (const invalid of [{ ...base, allowedModes: ["CUSTOMER_PICKUP"] }, { ...base, relation: "MARKETPLACE" }]) {
    body = invalid;
    await assert.rejects(readFulfillment(), readInvalid);
  }
  body = receipt(committed);
  assert.deepEqual(await writeFulfillment(change), body);
  body = receipt({ ...committed, allowedModes: ["PARTNER_CAPTAIN"] });
  await assert.rejects(writeFulfillment(change), writeUnknown);
  for (const allowedModes of [["CUSTOMER_PICKUP", "CUSTOMER_PICKUP"], null]) {
    await assert.rejects(writeFulfillment({ ...change, allowedModes }), invalidChange);
  }
  assert.equal(fetch.mock.callCount(), 5);
});

const storeInput = { operationId: "city-store-001", expectedVersion: 1, maxPauseSeconds: 900,
  maxPreparationMinutes: 30, reason: "before" };
const deliveryInput = { operationId: "city-delivery-001", expectedVersion: 2, radiusMetres: 20000,
  distanceBands: bands, reason: "before" };
const previewInput = { expectedVersion: 2, radiusMetres: 20000, distanceMetres: 2001, distanceBands: bands };
const commandCases = [
  {
    name: "fulfillment", input: change, invoke: writeFulfillment, method: "PATCH", error: writeUnknown,
    valid: receipt(committed),
    mutate: input => { input.allowedModes.push("PARTNER_CAPTAIN"); input.expectedVersion = 9; input.reason = "later"; },
    forged: receipt({ ...committed, version: 10, reason: "later",
      allowedModes: ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] }),
  },
  {
    name: "store", input: storeInput, method: "PATCH", error: writeUnknown,
    invoke: input => replaceCityStoreOperationalPolicy(origin, city, bearer, input),
    valid: receipt({ ...store, version: 2, changeReason: "before" }),
    mutate: input => { input.expectedVersion = 4; input.maxPauseSeconds = 1200; input.maxPreparationMinutes = 45; input.reason = "later"; },
    forged: receipt({ ...store, version: 5, maxPauseSeconds: 1200, maxPreparationMinutes: 45, changeReason: "later" }),
  },
  {
    name: "delivery", input: deliveryInput, method: "PATCH", error: writeUnknown,
    invoke: input => replaceCityDeliveryPolicy(origin, city, bearer, input),
    valid: receipt({ ...delivery, version: 3, distanceBands: bands }),
    mutate: input => { input.expectedVersion = 6; input.radiusMetres = 30000; input.distanceBands[0].ratePerKmMinor = 600; input.distanceBands[1].ratePerKmMinor = 500; },
    forged: receipt({ ...delivery, version: 7, radiusMetres: 30000,
      distanceBands: [{ upToMeters: 2000, ratePerKmMinor: 600 }, { upToMeters: null, ratePerKmMinor: 500 }] }),
  },
  {
    name: "preview", input: previewInput, method: "POST", error: readInvalid,
    invoke: input => previewCityDeliveryPolicy(origin, city, bearer, input),
    valid: { cityId: city, version: 2, radiusMetres: 20000, distanceMetres: 2001, feeYer: "601", payable: false },
    mutate: input => { input.expectedVersion = 6; input.radiusMetres = 30000; input.distanceMetres = 4000; input.distanceBands[0].ratePerKmMinor = 600; },
    forged: { cityId: city, version: 6, radiusMetres: 30000, distanceMetres: 4000, feeYer: "1200", payable: false },
  },
];

for (const item of commandCases) {
  test(item.name + " binds owner admission to the submitted snapshot and exact error", async t => {
    let finish;
    const fetch = t.mock.method(globalThis, "fetch", (_url, init) => {
      assert.equal(init.method, item.method);
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer " + bearer);
      assert.deepEqual(JSON.parse(init.body), item.input);
      return new Promise(resolve => { finish = resolve; });
    });
    for (const [body, expectedError] of [[item.valid, null], [item.forged, item.error]]) {
      const caller = structuredClone(item.input);
      finish = undefined;
      const pending = item.invoke(caller);
      assert.equal(typeof finish, "function", "request must already be dispatched");
      item.mutate(caller);
      finish(reply(body));
      if (expectedError) await assert.rejects(pending, expectedError);
      else assert.deepEqual(await pending, body);
    }
    assert.equal(fetch.mock.callCount(), 2, "no implicit retry");
  });
}

test("fulfillment captures indexed modes, normalizes Go Unicode and rejects forged receipts", async t => {
  const modes = [...change.allowedModes];
  modes[Symbol.iterator] = function* () {};
  let body = receipt({ ...committed, reason: "\uFEFFAdjust ceiling" });
  let input = { ...change, allowedModes: modes, reason: "\u0085\uFEFFAdjust ceiling\u0085" };
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { ...input, allowedModes: change.allowedModes });
    return reply(body);
  });
  assert.deepEqual(await writeFulfillment(input), body);
  input = { ...change, allowedModes: modes };
  body = receipt(committed, true);
  assert.deepEqual(await writeFulfillment(input), body);
  for (const policy of [
    { ...committed, reason: "wrong" }, { ...committed, version: 2 },
    { ...committed, allowedModes: ["PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] },
    { ...committed, allowedModes: ["CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"] },
    { ...committed, changedByActor: "ع".repeat(65) },
    { ...committed, reason: "invalid\u0085interior" },
    { ...committed, reason: " leading" }, { ...committed, changedByActor: "\u0085operator" },
  ]) {
    body = receipt(policy);
    await assert.rejects(writeFulfillment(input), writeUnknown);
  }
  assert.equal(fetch.mock.callCount(), 10);
});

test("malformed fulfillment text or sparse modes never reaches the owner", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not dispatch"); });
  for (const input of [
    { ...change, allowedModes: Array(1) },
    { ...change, reason: "\u0085" },
    { ...change, reason: "valid\uD800" },
    { ...change, reason: "valid\u0085inside" },
  ]) await assert.rejects(writeFulfillment(input), invalidChange);
  assert.equal(fetch.mock.callCount(), 0);
});

const readCases = [
  [signal => getCityStoreOperationalPolicy(origin, city, bearer, signal), store],
  [signal => listCityStoreOperationalPolicyHistory(origin, city, bearer, 20, undefined, signal), { cityId: city, entries: [store] }],
  [signal => getCityDeliveryPolicy(origin, city, bearer, signal), delivery],
  [signal => previewCityDeliveryPolicy(origin, city, bearer,
    { expectedVersion: 1, radiusMetres: 20000, distanceMetres: 1000, distanceBands: delivery.distanceBands }, signal),
    { cityId: city, version: 1, radiusMetres: 20000, distanceMetres: 1000, feeYer: "100", payable: false }],
  [readFulfillment, committed],
];

test("all reads reject final handoff abort and recover independently", async t => {
  let response;
  const fetch = t.mock.method(globalThis, "fetch", async () => response);
  for (const [invoke, body] of readCases) {
    const abort = new AbortController();
    response = reply(body);
    Object.defineProperty(response, "bodyUsed", { get() { abort.abort(); return true; } });
    await assert.rejects(invoke(abort.signal), { status: 0, code: "OWNER_RESPONSE_STALE" });
    response = reply(body);
    assert.deepEqual(await invoke(new AbortController().signal), body);
  }
  assert.equal(fetch.mock.callCount(), 10);
});

test("late abort of a committed fulfillment receipt retains unknown outcome", async t => {
  const abort = new AbortController();
  const response = reply(receipt(committed));
  Object.defineProperty(response, "bodyUsed", { get() { abort.abort(); return true; } });
  const fetch = t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(writeFulfillment(change, abort.signal), { status: 0, code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(fetch.mock.callCount(), 1);
});
