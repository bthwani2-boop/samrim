import assert from "node:assert/strict";
import test from "node:test";
import {
  DshPublicError, getStoreOperationalAvailability, updateStoreOperationalAvailability,
} from "../../services/dsh/clients/index.ts";

const base = "http://127.0.0.1:3202";
const storeId = "store-a";
const bearer = "isolated-bearer";
const availability = {
  storeId, timezone: "Asia/Aden",
  weekly: [{ weekday: 0, opens: 480, closes: 1020 }],
  preparationMinutes: 10, version: 1, actingActorId: "merchant-a", reason: "updated",
};
const change = {
  operationId: "stable-operation-001", expectedVersion: 1,
  weekly: [{ weekday: 0, opens: 480, closes: 1020 }],
  preparationMinutes: 10, reason: "updated",
};
function ownerJson(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
async function withFetch(fetcher, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await callback(); } finally { globalThis.fetch = previous; }
}
function rejectsAs(operation, code) {
  return assert.rejects(operation, error =>
    error instanceof DshPublicError && error.code === code);
}

test("valid owner Store availability readback and PATCH remain supported", async () => {
  let requests = 0;
  await withFetch(async (_url, init) => {
    requests++;
    assert.match(init.headers.Authorization, /^Bearer /);
    if (init.method === "GET") return ownerJson(availability);
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(init.body), change);
    return ownerJson({ availability, replay: false });
  }, async () => {
    assert.deepEqual(await getStoreOperationalAvailability(base, storeId, bearer), availability);
    assert.deepEqual(await updateStoreOperationalAvailability(base, storeId, bearer, change),
      { availability, replay: false });
  });
  assert.equal(requests, 2);
});

test("owner GET rejects undeclared private fields in Store availability and windows", async () => {
  for (const invalid of [
    { ...availability, internalStoreGrant: "secret-owner-value" },
    { ...availability, weekly: [{ ...availability.weekly[0], internalPolicy: true }] },
  ]) {
    await withFetch(async () => ownerJson(invalid), () =>
      rejectsAs(() => getStoreOperationalAvailability(base, storeId, bearer), "OWNER_RESPONSE_INVALID"));
  }
});

test("owner PATCH rejects undeclared success fields and private nested Store availability", async () => {
  for (const invalid of [
    { availability, replay: false, internalOwnerAudit: { actorToken: "private" } },
    { availability: { ...availability, internalStoreGrant: "private" }, replay: false },
    { availability: { ...availability, weekly: [{ ...availability.weekly[0], internalPolicy: true }] }, replay: false },
  ]) {
    await withFetch(async () => ownerJson(invalid), () =>
      rejectsAs(() => updateStoreOperationalAvailability(base, storeId, bearer, change),
        "OPERATION_RESULT_UNKNOWN"));
  }
});

test("client rejects unauthorized keys in outbound Store mutation before contacting DSH", async () => {
  let networkCalls = 0;
  await withFetch(async () => {
    networkCalls++;
    return ownerJson({ availability, replay: false });
  }, async () => {
    for (const invalid of [
      { ...change, overrideStoreGrant: true },
      { ...change, weekly: [{ ...change.weekly[0], overrideCityPolicy: true }] },
    ]) {
      await rejectsAs(() => updateStoreOperationalAvailability(base, storeId, bearer, invalid),
        "INVALID_OPERATIONAL_CHANGE");
    }
  });
  assert.equal(networkCalls, 0, "forged client mutation fields must not cross the SDK boundary");
});
