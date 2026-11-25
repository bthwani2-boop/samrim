import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW = "1";
process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = "http://127.0.0.1:3201";
const { handleCustomerMerchandiseEstimate } = await import("./cart-estimate-bff.ts");

const bearer = Buffer.alloc(32, 14).toString("base64url");
const page = "http://localhost/api/customer-auth/cart-estimate?storeId=store-a&expectedVersion=4";
const estimate = {
  actorId: "customer-a", storeId: "store-a", cartVersion: 4,
  lines: [{ offerId: "offer-a", variantId: "variant-a", quantity: 2,
    unitYer: "550", lineTotalYer: "1100" }],
  merchandiseSubtotalYer: "1100", checkoutReady: false,
};
const session = actorId => ({
  actorId, role: "customer", sessionExpiresAt: "2030-01-01T00:00:00Z",
});
const request = (url = page, extra = {}) => new Request(url, {
  headers: { Cookie: "bthwani_customer_auth=" + bearer, ...extra },
});
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

test("merchandise BFF rejects cross-site, invalid scope, and missing session without owner traffic", async t => {
  let called = 0;
  t.mock.method(globalThis, "fetch", async () => { called++; throw new Error("must not dispatch"); });
  const cases = [
    [request(page, { "Sec-Fetch-Site": "cross-site" }), 403],
    [request(page + "&storeId=store-b"), 400],
    [request(page + "&unexpected=1"), 400],
    [request(page.replace("store-a", "..")), 400],
    [request(page.replace("expectedVersion=4", "expectedVersion=04")), 400],
    [request(page.replace("expectedVersion=4", "expectedVersion=-1")), 400],
    [new Request(page), 401],
  ];
  for (const [req, want] of cases) {
    const result = await handleCustomerMerchandiseEstimate(req);
    assert.equal(result.status, want);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(called, 0);
});

test("merchandise BFF verifies Identity before and after one DSH owner read", async t => {
  const events = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = input.toString();
    events.push({ url, method: init.method, credentials: init.credentials });
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    if (url.startsWith("http://127.0.0.1:3201")) return json(session("customer-a"));
    if (url.startsWith("http://127.0.0.1:3202")) {
      assert.match(url, /\/v1\/carts\/store-a\/merchandise-estimate\?expectedVersion=4$/);
      assert.equal(init.method, "GET");
      return json(estimate);
    }
    throw new Error("unexpected URL " + url);
  });
  const result = await handleCustomerMerchandiseEstimate(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), estimate);
  assert.deepEqual(events.map(e => e.credentials), ["omit", "omit", "omit"]);
  assert.deepEqual(events.map(e => e.method), ["GET", "GET", "GET"]);
});

test("merchandise BFF never reveals result after Identity account switch", async t => {
  let identityReads = 0;
  t.mock.method(globalThis, "fetch", async input => {
    const url = input.toString();
    if (url.startsWith("http://127.0.0.1:3201")) {
      identityReads++;
      return json(session(identityReads === 1 ? "customer-a" : "customer-b"));
    }
    return json(estimate);
  });
  const result = await handleCustomerMerchandiseEstimate(request());
  assert.equal(result.status, 401);
  assert.equal((await result.json()).error, "UNAUTHORIZED");
  assert.equal(identityReads, 2);
});

test("merchandise BFF fails closed on DSH denial and does not retry", async t => {
  let identityReads = 0;
  let dshReads = 0;
  t.mock.method(globalThis, "fetch", async input => {
    const url = input.toString();
    if (url.startsWith("http://127.0.0.1:3201")) {
      identityReads++;
      return json(session("customer-a"));
    }
    dshReads++;
    return json({ error: "CART_LINE_UNAVAILABLE" }, 409);
  });
  const result = await handleCustomerMerchandiseEstimate(request());
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error, "ESTIMATE_NOT_AVAILABLE");
  assert.equal(dshReads, 1);
  assert.equal(identityReads, 1);
});
