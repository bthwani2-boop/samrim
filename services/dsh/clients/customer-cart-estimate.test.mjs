import assert from "node:assert/strict";
import test from "node:test";
import { DshCartError, parseCustomerCart, parseCustomerCartMerchandiseEstimate,
  parseCustomerCartResult, readCurrentCustomerCartMerchandiseEstimate } from "./customer-cart.ts";

const bearer = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
const valid = {
  actorId: "customer-a", storeId: "store-a", cartVersion: 4,
  lines: [{ offerId: "offer-a", variantId: "variant-a", quantity: 2, unitYer: "550", lineTotalYer: "1100" }],
  merchandiseSubtotalYer: "1100", checkoutReady: false,
};
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
test("DSH cart preview rejects amounts beyond the owner int64 YER bound", () => {
  const cart = {
    actorId: "customer-a", storeId: "store-a", version: 1,
    lines: [{
      offerId: "offer-a", variantId: "variant-a", name: "Rice",
      quantity: 1, previewUnitYer: "9223372036854775808", previewAvailable: true,
    }],
  };
  assert.throws(() => parseCustomerCart(cart, "store-a", "customer-a"),
    error => error instanceof DshCartError && error.code === "OWNER_RESPONSE_INVALID");
  assert.throws(() => parseCustomerCartResult({ cart, replay: false }, "store-a", "customer-a", 0),
    error => error instanceof DshCartError && error.code === "OWNER_RESPONSE_INVALID");
  const boundary = { ...cart, lines: [{ ...cart.lines[0], previewUnitYer: "9223372036854775807" }] };
  assert.deepEqual(parseCustomerCart(boundary, "store-a", "customer-a"), boundary);
});
test("merchandise estimate validates exact owner totals and refuses forged checkout eligibility", () => {
  assert.deepEqual(parseCustomerCartMerchandiseEstimate(valid, "store-a", "customer-a", 4), valid);
  for (const tampered of [
    { ...valid, actorId: "other-actor" },
    { ...valid, storeId: "other-store" },
    { ...valid, cartVersion: 3 },
    { ...valid, checkoutReady: true },
    { ...valid, merchandiseSubtotalYer: "1099" },
    { ...valid, merchandiseSubtotalYer: "9223372036854775808" },
    { ...valid, lines: [{...valid.lines[0], lineTotalYer: "1101"}] },
    { ...valid, lines: [valid.lines[0], valid.lines[0]] },
    { ...valid, lines: [{...valid.lines[0], quantity:2147483648}] },
  ]) {
    assert.throws(() => parseCustomerCartMerchandiseEstimate(tampered, "store-a", "customer-a", 4),
      error => error instanceof DshCartError && error.code === "OWNER_RESPONSE_INVALID");
  }
});
test("merchandise estimate uses only DSH's contract-derived authenticated GET", async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  let count = 0;
  globalThis.fetch = async (url, init) => {
    count++;
    assert.equal(url.pathname, "/v1/carts/store-a/merchandise-estimate");
    assert.equal(url.search, "?expectedVersion=4");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.body, undefined);
    return reply(valid);
  };
  const result = await readCurrentCustomerCartMerchandiseEstimate(
    "http://127.0.0.1:3202", bearer, "store-a", "customer-a", 4, new AbortController().signal);
  assert.deepEqual(result, valid);
  assert.equal(count, 1);
  await assert.rejects(readCurrentCustomerCartMerchandiseEstimate(
    "http://evil.test:3202", bearer, "store-a", "customer-a", 4, new AbortController().signal),
    error => error instanceof DshCartError && error.code === "OWNER_UNAVAILABLE");
  assert.equal(count, 1);
});
test("stale or unavailable estimate never causes an automatic write or retry", async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ error: "CART_LINE_UNAVAILABLE" }, 409); };
  await assert.rejects(readCurrentCustomerCartMerchandiseEstimate(
    "http://127.0.0.1:3202", bearer, "store-a", "customer-a", 4, new AbortController().signal),
    error => error instanceof DshCartError && error.code === "ESTIMATE_NOT_AVAILABLE");
  assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; return reply({...valid, checkoutReady:true}); };
  await assert.rejects(readCurrentCustomerCartMerchandiseEstimate(
    "http://127.0.0.1:3202", bearer, "store-a", "customer-a", 4, new AbortController().signal),
    error => error instanceof DshCartError && error.code === "OWNER_RESPONSE_INVALID");
  assert.equal(calls, 2);
});
