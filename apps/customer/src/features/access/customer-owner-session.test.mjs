import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW = "1";
process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = "http://127.0.0.1:3201";

const { handleCustomerCart } = await import("../cart/cart-bff.ts");
const { handleCustomerCartDirectory } = await import("../cart/cart-directory-bff.ts");
const { handleCustomerMerchandiseEstimate } = await import("../cart/cart-estimate-bff.ts");
const { handleCustomerAddresses } = await import("../addresses/address-bff.ts");
const { handleCustomerFavorites } = await import("../discovery/favorite-stores-bff.ts");
const { handleCustomerCheckoutReview } = await import("../checkout/checkout-review-bff.ts");

const actorId = "customer-a";
const storeId = "store-a";
const addressId = "addr-00000000000000000000000000000001";
const bearer = Buffer.alloc(32, 14).toString("base64url");
const cart = { actorId, storeId, version: 4, lines: [] };
const addressChange = { cityId: "sanaa", label: "Home", details: "Synthetic", latitude: 15.3, longitude: 44.2, expectedVersion: 0 };
const { expectedVersion: _version, ...addressFields } = addressChange;
const address = { id: addressId, ...addressFields, version: 1 };
const merchandise = { actorId, storeId, cartVersion: 4, lines: [{ offerId: "offer-a", variantId: "variant-a", quantity: 2, unitYer: "550", lineTotalYer: "1100" }], merchandiseSubtotalYer: "1100", checkoutReady: false };
const checkoutInput = { expectedCartVersion: 4, salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP" };
const checkout = { actorId, storeId, cartVersion: 4, salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP", merchandise, storeSchedule: { status: "OPEN_BY_SCHEDULE", version: 3 }, checkoutReady: false, blockers: ["FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"] };
function req(path, method = "GET", body) {
  return new Request("http://localhost/api/customer-auth/" + path, {
    method, headers: { Cookie: "bthwani_customer_auth=" + bearer, "X-Customer-Context": actorId, Origin: "http://localhost", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const cases = [
  ["cart read", () => handleCustomerCart(req("cart?storeId=store-a"), "GET"), cart, 401],
  ["cart write", () => handleCustomerCart(req("cart?storeId=store-a", "PUT", { operationId: "cart-proof-test", expectedVersion: 3, lines: [] }), "PUT"), { cart, replay: false }, 503],
  ["directory", () => handleCustomerCartDirectory(req("carts")), { actorId, carts: [] }, 401],
  ["estimate", () => handleCustomerMerchandiseEstimate(req("cart-estimate?storeId=store-a&expectedVersion=4")), merchandise, 401],
  ["address read", () => handleCustomerAddresses(req("addresses"), "GET"), { actorId, items: [address] }, 401],
  ["address write", () => handleCustomerAddresses(req("addresses?addressId=" + addressId, "PUT", addressChange), "PUT"), { actorId, address, replay: false }, 503],
  ["favorite read", () => handleCustomerFavorites(req("favorite-stores"), "GET"), { actorId, storeIds: [storeId] }, 401],
  ["favorite write", () => handleCustomerFavorites(req("favorite-stores?storeId=store-a&favorite=true", "PUT"), "PUT"), { actorId, storeId, favorite: true }, 503],
  ["checkout review", () => handleCustomerCheckoutReview(req("checkout-review?storeId=store-a", "POST", checkoutInput)), checkout, 401],
];
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
for (const [name, send, receipt, withheld] of cases) {
  test(name + " admits owner outcomes only within the original Identity proof", async t => {
    const start = Date.now();
    let now = start, reads = 0, calls = 0, late = false, denied = false, changed = false;
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "fetch", async input => {
      if (String(input).startsWith("http://127.0.0.1:3201")) {
        reads++;
        return json({ actorId: changed && reads > 1 ? "customer-b" : actorId, role: "customer",
          sessionExpiresAt: new Date(start + (reads === 1 ? 1000 : 60000)).toISOString() });
      }
      calls++;
      if (late) now = start + 1001;
      return denied ? json({ code: "FORBIDDEN" }, 403) : json(receipt);
    });
    const normal = await send();
    assert.equal(normal.status, 200);
    assert.deepEqual(await normal.json(), receipt);
    assert.equal(reads, 2);
    assert.equal(calls, 1);
    reads = 0; calls = 0; late = true;
    const expired = await send();
    assert.equal(expired.status, withheld);
    assert.deepEqual(await expired.json(), { error: withheld === 503 ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED" });
    assert.equal(calls, 1);
    now = start; reads = 0; calls = 0; late = false; denied = true; changed = true;
    const rejection = await send();
    assert.equal(rejection.status, withheld);
    assert.deepEqual(await rejection.json(), { error: withheld === 503 ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED" });
    assert.equal(reads, 2);
    assert.equal(calls, 1);
  });
}
