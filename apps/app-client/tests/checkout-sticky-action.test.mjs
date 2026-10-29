import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const footer = readFileSync(new URL("../src/features/order-experience/premium-order-ui.tsx", import.meta.url), "utf8");
const singleStore = readFileSync(new URL("../src/features/cart-checkout/client-cart-screen.tsx", import.meta.url), "utf8");
const multiStore = readFileSync(new URL("../src/features/multi-store-checkout/multi-store-checkout.tsx", import.meta.url), "utf8");

test("checkout sticky actions use the canonical themed button", () => {
  assert.match(footer, /import \{ BthwaniButton,/);
  assert.match(footer, /<BthwaniButton label=\{label\} busy=\{Boolean\(busy\)\} disabled=\{Boolean\(disabled\)\} onPress=\{onPress\} style=\{styles\.stickyButton\}/);
  assert.doesNotMatch(footer, /PremiumGradientAction|actionGradient|actionHit|actionDisabled|actionText/);
});

test("single-store and multi-store checkout share the canonical sticky action", () => {
  assert.match(singleStore, /<PremiumStickyFooter[\s\S]*?checkoutAction\.current\(\)/);
  assert.match(multiStore, /<PremiumStickyFooter[\s\S]*?onPress=\{\(\) => void submit\(\)\}/);
});