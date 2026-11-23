import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../app/api/admission+api.ts";

const identity = "http://127.0.0.1:13009";
const dsh = "http://127.0.0.1:13010";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const options = { choices: [{
  cityId: "sanaa", relation: "MARKETPLACE", policyVersion: 1,
  termsVersion: "merchant-terms-v1", termsText: "موافقة اختبار معزول، دون نشر أو تفعيل مالي.",
}], verticals: ["grocery"] };
const input = { operationId: "registration-merchant-a-001", cityId: "sanaa",
  verticalId: "grocery", relation: "MARKETPLACE", name: "متجر صنعاء",
  latitude: 15.3694, longitude: 44.191, policyVersion: 1,
  termsVersion: "merchant-terms-v1", acceptedTerms: true };
const store = { id: "store-11111111111111111111111111111111",
  name: input.name, relation: input.relation, published: false };
const ownerJSON = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function setEnv(t, key, value) {
  const before = process.env[key];
  t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  process.env[key] = value;
}
function ownerEnvironment(t, { role = "merchant", dshStatus = 200, replay = false, invalid = false, abort = false } = {}) {
  setEnv(t, "MERCHANT_SYNTHETIC_IDENTITY_ORIGIN", identity);
  setEnv(t, "MERCHANT_SYNTHETIC_DSH_ORIGIN", dsh);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, req) => {
    const target = new URL(url);
    calls.push({ pathname: target.pathname, method: req.method, body: req.body });
    assert.equal(req.redirect, "error");
    assert.equal(req.credentials, "omit");
    assert.equal(req.headers.Authorization, "Bearer " + bearer);
    if (target.origin === identity) {
      assert.equal(target.pathname, "/v1/sessions/current");
      assert.equal(req.method, "GET");
      return ownerJSON({ actorId: "owner-a", role,
        sessionExpiresAt: new Date(Date.now() + 120_000).toISOString() });
    }
    assert.equal(target.origin, dsh);
    if (target.pathname === "/v1/stores/registration-options") {
      assert.equal(req.method, "GET");
      return ownerJSON(invalid ? { ...options, choices: [{ ...options.choices[0], termsText: "" }] } : options);
    }
    assert.equal(target.pathname, "/v1/stores");
    assert.equal(req.method, "POST");
    assert.deepEqual(JSON.parse(req.body), input);
    if (abort) throw new Error("write may have committed");
    if (dshStatus !== 200) return ownerJSON({ code: "STORE_REGISTRATION_CLOSED" }, dshStatus);
    return ownerJSON({ store: invalid ? { ...store, published: true } : store, replay },
      replay ? 200 : 201);
  });
  return calls;
}
const cookies = token => token ? { Cookie: `bthwani_merchant_admission=${token}` } : {};
const get = (query = "?registration=options", token = bearer, extra = {}) =>
  new Request(`http://localhost:18102/api/admission${query}`, {
    headers: { ...cookies(token), ...extra },
  });
const post = (payload = input, token = bearer, extra = {}, query = "?registration=create") =>
  new Request(`http://localhost:18102/api/admission${query}`, {
    method: "POST", headers: {
      ...cookies(token), Origin: "http://localhost:18102",
      "Content-Type": "application/json", ...extra,
    },
    body: JSON.stringify({ storeRegistration: payload }),
  });

test("Merchant admission options are bound to current Identity and a live DSH policy", async t => {
  const calls = ownerEnvironment(t);
  const reply = await GET(get());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { options });
  assert.equal(reply.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current", "/v1/stores/registration-options"]);
});
test("Merchant BFF creates an unpublished Store and forwards no caller-supplied owner authority", async t => {
  const calls = ownerEnvironment(t);
  const reply = await POST(post());
  assert.equal(reply.status, 201);
  assert.deepEqual(await reply.json(), { registration: { store, replay: false } });
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current", "/v1/stores"]);
});
test("Merchant BFF supports owner-backed idempotency replay, not a second Store", async t => {
  ownerEnvironment(t, { replay: true });
  const reply = await POST(post());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { registration: { store, replay: true } });
});
test("Merchant registration requires a live Merchant session before contacting DSH", async t => {
  let calls = ownerEnvironment(t, { role: "customer" });
  assert.equal((await GET(get())).status, 401);
  assert.equal((await POST(post())).status, 403);
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current", "/v1/sessions/current"]);
});
test("Merchant registration rejects anonymous, cross-actor, malformed and cross-site requests", async t => {
  const calls = ownerEnvironment(t);
  assert.equal((await GET(get(undefined, ""))).status, 401);
  assert.equal((await POST(post(input, ""))).status, 401);
  assert.equal((await GET(get("?registration=options&actorId=other"))).status, 400);
  assert.equal((await POST(post(input, bearer, { Origin: "http://evil.test" }))).status, 403);
  assert.equal((await POST(post(input, bearer, { "X-Merchant-Context": "other" }))).status, 403);
  assert.equal((await POST(post(input, bearer, {}, "?registration=create&actorId=other"))).status, 400);
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current"]);
});
test("Merchant refuses invalid DSH terms text and published Store result", async t => {
  ownerEnvironment(t, { invalid: true });
  assert.equal((await GET(get())).status, 503);
  assert.equal((await POST(post())).status, 503);
});
test("Owner policy denial preserves Merchant session; never manufactures a Store", async t => {
  ownerEnvironment(t, { dshStatus: 403 });
  const reply = await POST(post());
  assert.equal(reply.status, 403);
  assert.deepEqual(await reply.json(), { code: "STORE_REGISTRATION_CLOSED" });
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
test("Unknown DSH write outcome requires same operation id retry, not a false success", async t => {
  ownerEnvironment(t, { abort: true });
  const reply = await POST(post());
  assert.equal(reply.status, 503);
  assert.deepEqual(await reply.json(), { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
