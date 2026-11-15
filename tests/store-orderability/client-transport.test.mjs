import test from "node:test";
import assert from "node:assert/strict";
import {
  DshPublicError,
  getStoreOperationalAvailability,
  updateStoreOperationalAvailability,
} from "../../services/dsh/clients/index.ts";

const base = "http://127.0.0.1:18080";
const storeId = "store-a";
const snapshot = {
  storeId,
  timezone: "Asia/Aden",
  weekly: [{ weekday: 1, opens: 600, closes: 1200 }],
  preparationMinutes: 20,
  version: 2,
  actingActorId: "merchant-a",
  reason: "Synthetic schedule",
};
const change = {
  operationId: "change-0001",
  expectedVersion: 1,
  weekly: [],
  preparationMinutes: 0,
  reason: "Explicitly close schedule",
};
function jsonResponse(body, status = 200, contentType = "application/json; charset=utf-8") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

test("private GET uses a fresh bearer with no redirects, cache or cookie credentials", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, base + "/v1/stores/store-a/availability");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, "Bearer token-a");
    assert.equal(options.body, undefined);
    return jsonResponse(snapshot);
  });
  const read = await getStoreOperationalAvailability(base, storeId, "token-a");
  assert.deepEqual(read, snapshot);
  assert.equal(calls, 1);
});

test("private PATCH allows explicitly empty schedule and explicit zero preparation only", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, base + "/v1/stores/store-a/availability");
    assert.equal(options.method, "PATCH");
    assert.equal(options.headers.Authorization, "Bearer token-a");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), change);
    return jsonResponse({ availability: { ...snapshot, weekly: [], preparationMinutes: 0 }, replay: true });
  });
  const result = await updateStoreOperationalAvailability(base, storeId, "token-a", change);
  assert.equal(result.replay, true);
  assert.deepEqual(result.availability.weekly, []);
  assert.equal(calls, 1);
});

test("missing schedule, invalid preparation and missing bearer reject before contacting DSH", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected network"); });
  const invalid = [
    { ...change, weekly: undefined },
    { ...change, weekly: null },
    { ...change, preparationMinutes: undefined },
    { ...change, preparationMinutes: -1 },
  ];
  for (const body of invalid) {
    await assert.rejects(
      updateStoreOperationalAvailability(base, storeId, "token-a", body),
      (err) => err instanceof DshPublicError && err.status === 400 && err.code === "INVALID_OPERATIONAL_CHANGE",
    );
  }
  await assert.rejects(
    getStoreOperationalAvailability(base, storeId, "has whitespace"),
    (err) => err instanceof DshPublicError && err.status === 401,
  );
  await assert.rejects(
    getStoreOperationalAvailability("http://public.example", storeId, "token-a"),
    (err) => err instanceof DshPublicError && err.code === "DSH_ENDPOINT_UNSAFE",
  );
  assert.equal(calls, 0);
});

test("DSH denial is preserved with no leaking bearer and invalid owner JSON fails closed", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ code: "STORE_OPERATION_FORBIDDEN" }, 403));
  await assert.rejects(
    getStoreOperationalAvailability(base, storeId, "secret-token"),
    (err) => err instanceof DshPublicError &&
      err.status === 403 && err.code === "STORE_OPERATION_FORBIDDEN" &&
      !String(err).includes("secret-token"),
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ ...snapshot, storeId: "store-b" }));
  await assert.rejects(
    getStoreOperationalAvailability(base, storeId, "token-a"),
    (err) => err instanceof DshPublicError && err.status === 502 && err.code === "OWNER_RESPONSE_INVALID",
  );
});

test("unparseable, non-JSON and oversized responses fail closed", async (t) => {
  for (const response of [
    jsonResponse("not JSON"),
    jsonResponse("OK", 200, "text/plain"),
    jsonResponse(" ".repeat(32769)),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      getStoreOperationalAvailability(base, storeId, "token-a"),
      (err) => err instanceof DshPublicError && err.code === "OWNER_RESPONSE_INVALID",
    );
    t.mock.restoreAll();
  }
});

test("network failure becomes a stable owner error without leaking internal exception", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private network detail"); });
  await assert.rejects(
    getStoreOperationalAvailability(base, storeId, "token-a"),
    (err) => err instanceof DshPublicError &&
      err.code === "OWNER_NETWORK_UNAVAILABLE" && !String(err).includes("private network detail"),
  );
});
