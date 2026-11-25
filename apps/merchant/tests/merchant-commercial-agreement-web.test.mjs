import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/admission+api.ts";

const identity = "http://127.0.0.1:13009";
const wlt = "http://127.0.0.1:13011";
const bearer = Buffer.alloc(32, 8).toString("base64url");
function request(query = "?agreement=store-a", actor = "owner-a", token = bearer) {
  return new Request("http://localhost:18102/api/admission" + query, {
    headers: { ...(token ? { Cookie: "bthwani_merchant_admission=" + token } : {}),
      ...(actor ? { "X-Merchant-Context": actor } : {}) },
  });
}
function owners(t, { role = "merchant", status = 200, review = { storeId: "store-a", proposal: null } } = {}) {
  for (const [name, value] of Object.entries({ MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: identity, MERCHANT_SYNTHETIC_WLT_ORIGIN: wlt })) {
    const old = process.env[name];
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
    process.env[name] = value;
  }
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    calls.push(target.href);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const json = (body, code = 200) => Response.json(body, { status: code, headers: { "Cache-Control": "no-store" } });
    if (target.origin === identity) return json({ actorId: "owner-a", role, sessionExpiresAt: new Date(Date.now() + 120000).toISOString() });
    assert.equal(target.href, wlt + "/v1/merchants/stores/store-a/commercial-agreement");
    return json(review, status);
  });
  return calls;
}
test("agreement reads verified store proposal from WLT, without writes", async t => {
  const calls = owners(t);
  const reply = await GET(request());
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await reply.json(), { agreement: { actorId: "owner-a", review: { storeId: "store-a", proposal: null } } });
  assert.equal(calls.length, 2);
});
test("agreement rejects missing or wrong actor and invalid query", async t => {
  const calls = owners(t);
  for (const actor of ["", "owner-b"]) assert.equal((await GET(request(undefined, actor))).status, 403);
  assert.equal((await GET(request(undefined, undefined, ""))).status, 401);
  assert.equal((await GET(request("?agreement=store-a&agreement=store-b"))).status, 400);
  assert.equal(calls.length, 2);
});
test("WLT store denial does not clear unrelated Merchant session", async t => {
  owners(t, { status: 403 });
  const reply = await GET(request());
  assert.equal(reply.status, 403);
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
test("wrong store reply fails closed", async t => {
  owners(t, { review: { storeId: "store-b", proposal: null } });
  assert.equal((await GET(request())).status, 503);
});

const proposal = {
  version: 2, operationId: "proposal-0002", storeRelation: "DIRECT", feeModel: "SUBSCRIPTION",
  collector: "STORE_MANAGED", currency: "YER", commissionBasisPoints: null,
  subscriptionAmountYer: "9007199254740993", subscriptionPeriodDays: 30,
  fulfillmentModes: ["CUSTOMER_PICKUP"], proposedEffectiveAt: "2027-01-01T00:00:00Z",
  reviewState: "REVIEW_APPROVED_PENDING_ACTIVATION",
};
test("agreement preserves exact WLT proposed subscription and never claims activation", async t => {
  const review = { storeId: "store-a", proposal };
  owners(t, { review });
  const reply = await GET(request());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { agreement: { actorId: "owner-a", review } });
});
test("non-Merchant actor cannot contact WLT", async t => {
  const calls = owners(t, { role: "customer" });
  assert.equal((await GET(request())).status, 401);
  assert.equal(calls.length, 1);
});
test("invalid owner origin never receives the Merchant bearer", async t => {
  const calls = owners(t);
  process.env.MERCHANT_SYNTHETIC_WLT_ORIGIN = "https://example.invalid";
  assert.equal((await GET(request())).status, 503);
  assert.equal(calls.length, 1);
});
test("WLT unavailability fails closed without discarding the Merchant session", async t => {
  owners(t, { status: 503 });
  const reply = await GET(request());
  assert.equal(reply.status, 503);
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
