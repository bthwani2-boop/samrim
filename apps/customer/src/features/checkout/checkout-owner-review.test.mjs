import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const checkout = new URL("./checkout-screen.tsx", import.meta.url);
const cart = new URL("../cart/cart-screen.tsx", import.meta.url);

test("Checkout review reads only the actor-scoped current DSH Cart and never constructs an Order", () => {
  const code = readFileSync(checkout, "utf8");
  assert.match(code, /useLocalSearchParams/);
  assert.match(code, /useFocusEffect/);
  assert.match(code, /readVerifiedCart\(storeId,/);
  assert.match(code, /summarizeCartPreview\(cart\.lines\)/);
  assert.match(code, /previewLineSubtotalYer\(line\)/);
  assert.match(code, /BigInt/);
  assert.match(code, /controller\.abort\(\)/);
  assert.match(code, /view\.cart\.storeId === storeId/);
  assert.doesNotMatch(code, /createOrder\(|confirmOrder\(|walletDebit\(|charge\(|fetch\(|AsyncStorage/);
});

test("Customer can navigate from committed Store Cart to the same-Store read-only review", () => {
  const code = readFileSync(cart, "utf8");
  assert.match(code, /pathname: "\/checkout"/);
  assert.match(code, /params: \{ storeId \}/);
  assert.match(code, /const pending = view\?\.kind === "ready" \? pendingCartChange\(view\.cart\.actorId, storeId\) : undefined/);
  assert.match(code, /view\?\.kind === "ready" && view\.cart\.lines\.length > 0 &&\s*!busy && !pending && !error \? \(\s*<Link href=\{\{ pathname: "\/checkout", params: \{ storeId \} \}\}/);
});
