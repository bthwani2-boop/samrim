import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const parent = readFileSync(new URL("cart-checkout/client-cart-screen.tsx", root), "utf8");
const checkout = readFileSync(new URL("cart-checkout/cart-checkout.tsx", root), "utf8");
const tracking = readFileSync(new URL("orders/order-detail.tsx", root), "utf8");
const journey = readFileSync(new URL("orders/order-journey.ts", root), "utf8");

test("delivery address is loaded after async fulfillment mode selection", () => {
  assert.match(parent, /\[loadAddresses, state\.kind, fulfillmentMode\]/);
  assert.match(parent, /evaluateAddress\(addressesState\.addresses\[0\]!\.id\)/);
  assert.match(parent, /serviceability\.result\.status === "SERVICEABLE"/);
});
test("checkout invoice and submitted payment use authoritative quote", () => {
  assert.match(checkout, /quoteCheckout\(/);
  assert.match(checkout, /verifiedQuote\.deliveryFeeMinor/);
  assert.match(checkout, /expectedTotalAmountMinor: quote\.quote\.totalAmountMinor/);
  assert.match(checkout, /!pickupMode && !serviceableAddressId/);
  assert.match(checkout, /"بانتظار العنوان"/);
});
test("in-transit view is based on persisted custody and periodic readback", () => {
  assert.match(journey, /order\.state === "IN_CUSTODY"/);
  assert.match(journey, /"طلبك في الطريق إليك"/);
  assert.match(tracking, /30_000/);
  assert.match(tracking, /readOrder\(token, orderId\)/);
  assert.match(tracking, /لا يوجد تتبع مباشر/);
});
