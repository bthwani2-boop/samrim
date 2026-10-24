import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checkout = readFileSync(new URL("./cart-checkout.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("./client-cart-screen.tsx", import.meta.url), "utf8");

test("footer update is stable and ignores equal state", () => {
  assert.match(parent, /const updateFooter = useCallback\(/);
  assert.match(parent, /previous\.totalReady === next\.totalReady/);
  assert.match(parent, /const openRequiredAddress = useCallback\(/);
  assert.match(parent, /onRequiredAddress=\{openRequiredAddress\}/);
});
test("closed store prevents checkout pricing and provides refresh", () => {
  assert.match(parent, /storeAcceptingOrders=\{!selectedOrderability \|\| selectedOrderability\.state === "OPEN_FOR_ORDERS"\}/);
  assert.match(checkout, /if \(!storeAcceptingOrders\)/);
  assert.match(checkout, /const verifiedQuote = storeAcceptingOrders &&/);
  assert.match(checkout, /if \(canRefreshStore\) onRefreshStore\?\.\(\)/);
  assert.match(checkout, /"STORE_NOT_ACCEPTING_ORDERS"/);
});
test("delivery fee remains server-quoted, never replaced by a local guess", () => {
  assert.match(checkout, /client\(\)\.quoteCheckout\(/);
  assert.match(checkout, /verifiedQuote\.deliveryFeeMinor/);
  assert.match(checkout, /expectedTotalAmountMinor: quote\.quote\.totalAmountMinor/);
});
