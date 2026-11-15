import test from "node:test";
import assert from "node:assert/strict";
import {
  DshPublicError,
  getStoreOperationalAvailability,
  getCityStoreOperationalPolicy,
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

test("ambiguous PATCH transport failure never claims that no Store write committed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network dropped after request reached Store owner");
  });
  await assert.rejects(
    updateStoreOperationalAvailability(base, storeId, "token-a", change),
    (err) => err instanceof DshPublicError && err.status === 0 &&
      err.code === "OPERATION_RESULT_UNKNOWN" &&
      !String(err).includes("network dropped"),
  );
});

test("PATCH with a successful but unverifiable server response is an unknown write result", async (t) => {
  for (const response of [
    jsonResponse("invalid JSON"),
    jsonResponse("OK", 200, "text/plain"),
    jsonResponse({ availability: { ...snapshot, storeId: "different-store" }, replay: false }),
    jsonResponse({ availability: snapshot, replay: "not a boolean" }),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      updateStoreOperationalAvailability(base, storeId, "token-a", change),
      (err) => err instanceof DshPublicError && err.code === "OPERATION_RESULT_UNKNOWN",
    );
    t.mock.restoreAll();
  }
});

test("aborted PATCH is conservatively unknown, whereas a cancelled GET stays cancellable", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    throw new Error("cancelled while request might have committed");
  });
  await assert.rejects(
    updateStoreOperationalAvailability(base, storeId, "token-a", change, controller.signal),
    (err) => err instanceof DshPublicError && err.code === "OPERATION_RESULT_UNKNOWN",
  );
});

test("unverifiable server-side PATCH failure is unknown, but an explicit 409 conflict is preserved", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse("gateway unavailable", 503, "text/plain"));
  await assert.rejects(
    updateStoreOperationalAvailability(base, storeId, "token-a", change),
    (err) => err instanceof DshPublicError && err.status === 503 && err.code === "OPERATION_RESULT_UNKNOWN",
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ code: "STORE_AVAILABILITY_VERSION_CONFLICT" }, 409));
  await assert.rejects(
    updateStoreOperationalAvailability(base, storeId, "token-a", change),
    (err) => err instanceof DshPublicError &&
      err.status === 409 && err.code === "STORE_AVAILABILITY_VERSION_CONFLICT",
  );
});

test("non-JSON content type prefix is not trusted as an owner response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(snapshot, 200, "application/jsonp"));
  await assert.rejects(
    getStoreOperationalAvailability(base, storeId, "token-a"),
    (err) => err instanceof DshPublicError && err.code === "OWNER_RESPONSE_INVALID",
  );
  await assert.rejects(
    updateStoreOperationalAvailability(base, storeId, "token-a", change),
    (err) => err instanceof DshPublicError && err.code === "OPERATION_RESULT_UNKNOWN",
  );
});

test("cancelled private GET never returns a stale Store response after account switch", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return jsonResponse(snapshot);
  });
  await assert.rejects(
    getStoreOperationalAvailability(base, storeId, "old-account-bearer", controller.signal),
    (err) => err instanceof DshPublicError && err.code === "OWNER_RESPONSE_STALE",
  );
});

test("cancelled private PATCH never presents a late success as an accepted current-account write", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return jsonResponse({ availability: snapshot, replay: false });
  });
  await assert.rejects(
    updateStoreOperationalAvailability(base, storeId, "old-account-bearer", change, controller.signal),
    (err) => err instanceof DshPublicError && err.code === "OPERATION_RESULT_UNKNOWN",
  );
});

test("private city policy GET requires an explicit bearer and never sends a mutation", async (t) => {
  const policy = {
    cityId: "city-a", version: 1, maxPauseSeconds: 3600,
    maxPreparationMinutes: 90, changedByActor: "operator-a",
    changeReason: "Reviewed policy", updatedAt: "2026-11-15T13:00:00Z",
  };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, base + "/v1/operators/cities/city-a/store-availability-policy");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer operator-bearer");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    return jsonResponse(policy);
  });
  assert.deepEqual(
    await getCityStoreOperationalPolicy(base, "city-a", "operator-bearer"),
    policy,
  );
  assert.equal(calls, 1);
});

test("private city policy GET rejects wrong city, invalid bounds and a revoked permission", async (t) => {
  const policy = {
    cityId: "city-a", version: 1, maxPauseSeconds: 3600,
    maxPreparationMinutes: 90, changedByActor: "operator-a",
    changeReason: "Reviewed policy", updatedAt: "2026-11-15T13:00:00Z",
  };
  for (const body of [
    { ...policy, cityId: "other-city" },
    { ...policy, version: 0 },
    { ...policy, maxPauseSeconds: 31536001 },
    { ...policy, maxPreparationMinutes: -1 },
  ]) {
    t.mock.method(globalThis, "fetch", async () => jsonResponse(body));
    await assert.rejects(
      getCityStoreOperationalPolicy(base, "city-a", "operator-bearer"),
      (err) => err instanceof DshPublicError && err.code === "OWNER_RESPONSE_INVALID",
    );
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ code: "STORE_OPERATION_FORBIDDEN" }, 403));
  await assert.rejects(
    getCityStoreOperationalPolicy(base, "city-a", "operator-bearer"),
    (err) => err instanceof DshPublicError && err.status === 403,
  );
});

test("private city policy read cannot display stale data after Operator account switching", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return jsonResponse({
      cityId: "city-a", version: 1, maxPauseSeconds: 10,
      maxPreparationMinutes: 20, changedByActor: "operator-a",
      changeReason: "Old session", updatedAt: "2026-11-15T13:00:00Z",
    });
  });
  await assert.rejects(
    getCityStoreOperationalPolicy(base, "city-a", "old-operator", controller.signal),
    (err) => err instanceof DshPublicError && err.code === "OWNER_RESPONSE_STALE",
  );
});
