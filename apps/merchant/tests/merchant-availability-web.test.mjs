import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, PATCH } from "../app/api/admission+api.ts";

const identity = "http://127.0.0.1:13009";
const dsh = "http://127.0.0.1:13010";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const availability = {
  storeId: "store-a", timezone: "Asia/Aden", weekly: null,
  preparationMinutes: 12, version: 3, actingActorId: "owner-a", reason: "reviewed",
};
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function environment(t, name, value) {
  const previous = process.env[name];
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  process.env[name] = value;
}
function request(query = "?availability=store-a", token = bearer) {
  return new Request(`http://localhost:18102/api/admission${query}`, {
    headers: {
      ...(token ? { Cookie: `bthwani_merchant_admission=${token}` } : {}),
      "X-Actor-ID": "forged-owner", "X-Role": "operator",
    },
  });
}
function owners(t, { role = "merchant", identityStatus = 200, dshStatus = 200, body = availability, change } = {}) {
  environment(t, "MERCHANT_SYNTHETIC_IDENTITY_ORIGIN", identity);
  environment(t, "MERCHANT_SYNTHETIC_DSH_ORIGIN", dsh);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    calls.push(target.href);
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal.aborted, false);
    assert.equal(options.headers["X-Actor-ID"], undefined);
    if (target.origin === identity) {
      assert.equal(options.method, "GET");
      assert.equal(target.pathname, "/v1/sessions/current");
      return identityStatus === 200 ? json({ actorId: "owner-a", role,
        sessionExpiresAt: new Date(Date.now() + 120000).toISOString() }) : json({ error: "FORBIDDEN" }, identityStatus);
    }
    assert.equal(target.origin, dsh);
    assert.equal(target.pathname, "/v1/stores/store-a/availability");
    assert.equal(options.method, change ? "PATCH" : "GET");
    if (change) assert.deepEqual(JSON.parse(options.body), change);
    return dshStatus === 200 ? json(body) : json({ code: "STORE_OPERATION_FORBIDDEN" }, dshStatus);
  });
  return calls;
}

test("Merchant availability BFF verifies Identity then reads the selected DSH Store without writing", async t => {
  const calls = owners(t);
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(await response.json(), { availability });
  assert.equal(calls.length, 2);
});

test("Merchant availability requires a session before contacting either owner", async t => {
  const calls = owners(t);
  assert.equal((await GET(request(undefined, ""))).status, 401);
  assert.equal(calls.length, 0);
});

for (const role of ["customer", "captain", "operator"]) {
  test(`Merchant availability rejects the ${role} role before DSH`, async t => {
    const calls = owners(t, { role });
    const response = await GET(request());
    assert.equal(response.status, 401);
    assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
    assert.equal(calls.length, 1);
  });
}

test("Revoked Identity session clears its cookie without reading Store data", async t => {
  const calls = owners(t, { identityStatus: 403 });
  const response = await GET(request());
  assert.equal(response.status, 403);
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(calls.length, 1);
});

test("Cross-Store denial preserves the valid Merchant cookie and propagates the DSH refusal", async t => {
  owners(t, { dshStatus: 403 });
  const response = await GET(request());
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(await response.json(), { code: "STORE_OPERATION_FORBIDDEN" });
});

test("An owner response for another Store is rejected", async t => {
  owners(t, { body: { ...availability, storeId: "store-b" } });
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "OWNER_UNAVAILABLE" });
});

test("Unknown, repeated and injected availability queries never reach owners", async t => {
  const calls = owners(t);
  for (const query of ["?availability=", "?availability=../store-a", "?availability=store-a&availability=store-b",
    "?availability=store-a&actorId=forged", "?availability=store-a&origin=https://evil.test", "?unknown=store-a"]) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
  assert.equal(calls.length, 0);
});

for (const owner of ["identity", "dsh"]) {
  test(`Missing ${owner} configuration fails closed for availability`, async t => {
    const calls = owners(t);
    environment(t, "NODE_ENV", "production");
    environment(t, owner === "identity" ? "MERCHANT_SYNTHETIC_IDENTITY_ORIGIN" : "MERCHANT_SYNTHETIC_DSH_ORIGIN", "");
    assert.equal((await GET(request())).status, 503);
    assert.equal(calls.length, owner === "identity" ? 0 : 1);
  });
}

test("DSH outage retains the Merchant session for a recoverable retry", async t => {
  owners(t, { dshStatus: 503 });
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

const command = { operationId: "test-pause-01", expectedVersion: 3, weekly: [],
  preparationMinutes: 12, pausedUntil: null, reason: "انتهاء الإيقاف" };
function mutation(origin = "http://localhost:18102", actor = "owner-a", payload = command) {
  return new Request("http://localhost:18102/api/admission?availability=store-a", {
    method: "PATCH",
    headers: { Origin: origin, "X-Merchant-Context": actor, "Content-Type": "application/json",
      Cookie: `bthwani_merchant_admission=${bearer}` },
    body: JSON.stringify(payload),
  });
}

test("PATCH preserves the DSH result and exact retry payload", async t => {
  const result = { availability: { ...availability, weekly: [], version: 4 }, replay: true };
  const calls = owners(t, { change: command, body: result });
  const response = await PATCH(mutation());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), result);
  assert.equal(calls.length, 2);
});

test("PATCH rejects cross-origin, stale actor context and oversized commands", async t => {
  const calls = owners(t);
  assert.equal((await PATCH(mutation("http://localhost:9999"))).status, 403);
  assert.equal((await PATCH(mutation(undefined, undefined, { reason: "a".repeat(18000) }))).status, 400);
  assert.equal(calls.length, 0);
  const stale = await PATCH(mutation(undefined, "owner-b"));
  assert.equal(stale.status, 403);
  assert.equal(stale.headers.get("Set-Cookie"), null);
  assert.deepEqual(await stale.json(), { code: "MERCHANT_CONTEXT_CHANGED" });
  assert.equal(calls.length, 1);
});

test("PATCH DSH failure retains the unknown-result classification", async t => {
  owners(t, { change: command, dshStatus: 503 });
  const response = await PATCH(mutation());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "OPERATION_RESULT_UNKNOWN" });
});
