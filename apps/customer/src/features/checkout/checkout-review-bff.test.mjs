import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCustomerCheckoutReview, validCustomerCheckoutReviewInput } from "@bthwani/dsh";
process.env.BTHWANI_SURFACE_PREVIEW = "1";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = "http://127.0.0.1:3210";
const { handleCustomerCheckoutReview } = await import("./checkout-review-bff.ts");
const bearer = Buffer.alloc(32, 14).toString("base64url");
const page = "http://localhost/api/customer-auth/checkout-review?storeId=store-a";
const input = { expectedCartVersion: 4, recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP" };
const result = { actorId: "customer-a", storeId: "store-a", cartVersion: 4,
  recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP",
  merchandise: { actorId: "customer-a", storeId: "store-a", cartVersion: 4,
    lines: [{ offerId: "offer-a", variantId: "variant-a", quantity: 2, unitYer: "550", lineTotalYer: "1100" }],
    merchandiseSubtotalYer: "1100", checkoutReady: false },
  storeSchedule: { status: "OPEN_BY_SCHEDULE", version: 3 },
  checkoutReady: false, blockers: ["FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"] };
const request = (body = input, extra = {}, url = page) => new Request(url, { method: "POST",
  headers: { Cookie: "bthwani_surface_customer_auth=" + bearer, Origin: "http://localhost",
    "Content-Type": "application/json", "X-Customer-Context": "customer-a", ...extra }, body: JSON.stringify(body) });
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const session = actorId => ({ actorId, role: "customer", sessionExpiresAt: "2030-01-01T00:00:00Z" });
test("review SDK refuses unsolicited PII, changed scope, prices and payable state", () => {
  assert.deepEqual(parseCustomerCheckoutReview(result, "store-a", "customer-a", input), result);
  for (const invalid of [{ ...result, recipientPhone: "+967770000001" }, { ...result, actorId: "customer-b" },
    { ...result, cartVersion: 5 }, { ...result, fulfillmentMode: "BTHWANI_CAPTAIN" },
    { ...result, checkoutReady: true }, { ...result, blockers: [] },
    { ...result, storeSchedule: { status: "OPEN_FOR_ORDERS", version: 3 } },
    { ...result, storeSchedule: { status: "PAUSED" } },
    { ...result, storeSchedule: { status: "UNAVAILABLE", version: 1 } },
    { ...result, merchandise: { ...result.merchandise, merchandiseSubtotalYer: "1" } }]) {
    assert.throws(() => parseCustomerCheckoutReview(invalid, "store-a", "customer-a", input));
  }
  for (const invalid of [{ ...input, recipientName: "Other" }, { ...input, addressId: "address-a" },
    { ...input, fulfillmentMode: "BTHWANI_CAPTAIN" }, { ...input, recipientPurpose: "OTHER" },
    { ...input, expectedCartVersion: 0 }]) assert.equal(validCustomerCheckoutReviewInput(invalid), false);
});
test("review BFF rejects cross-site, missing session, invalid payload and duplicate selector before owner traffic", async t => {
  let called = 0;
  t.mock.method(globalThis, "fetch", async () => { called++; throw new Error("must not dispatch"); });
  for (const [req, status] of [[request(input, { Origin: "http://evil.test" }), 403],
    [request(input, { Cookie: "" }), 401], [request({ ...input, amountYer: 1 }), 400],
    [request(input, {}, page + "&storeId=store-b"), 400]]) {
    const res = await handleCustomerCheckoutReview(req);
    assert.equal(res.status, status); assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(called, 0);
});
test("review BFF verifies current Identity before and after one exact DSH request", async t => {
  const events = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    events.push(init.method);
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    if (url.toString().startsWith("http://127.0.0.1:3210")) return json(session("customer-a"));
    assert.match(url.toString(), /\/v1\/carts\/store-a\/checkout-review$/);
    assert.deepEqual(JSON.parse(init.body), input); return json(result);
  });
  const res = await handleCustomerCheckoutReview(request());
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), result);
  assert.deepEqual(events, ["GET", "POST", "GET"]);
});
test("review BFF withholds result after actor switch", async t => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async url => url.toString().startsWith("http://127.0.0.1:3210")
    ? json(session(++reads === 1 ? "customer-a" : "customer-b")) : json(result));
  const res = await handleCustomerCheckoutReview(request());
  assert.equal(res.status, 401); assert.equal((await res.json()).error, "UNAUTHORIZED");
  assert.equal(reads, 2);
});
