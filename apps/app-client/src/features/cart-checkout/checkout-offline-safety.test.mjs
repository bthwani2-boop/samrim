import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const checkout = readFileSync(new URL("./cart-checkout.tsx", import.meta.url), "utf8");

test("checkout detects real offline state without assuming unknown means offline", () => {
  assert.match(checkout, /import \{ useNetworkState \} from "expo-network"/);
  assert.match(checkout, /isConnected === false \|\| isInternetReachable === false/);
});

test("offline guard runs before acquiring checkout identity or persisting an attempt", () => {
  const operation = checkout.slice(checkout.indexOf("  async function checkout() {"), checkout.indexOf("  const quotedTotalMinor"));
  assert.match(operation, /if \(isOffline\) \{\s*setError\(/);
  assert.ok(operation.indexOf("if (isOffline)") < operation.indexOf("checkoutSubmitting.current = true"));
  assert.ok(operation.indexOf("if (isOffline)") < operation.indexOf("SecureStore.setItemAsync(storageKey"));
  assert.match(operation, /checkoutSubmitting\.current = true/);
  assert.match(operation, /idempotencyKey: `cart_checkout_\$\{Crypto\.randomUUID\(\)\}`/);
});

test("both footer and inline checkout block offline orders while restoring online availability", () => {
  assert.match(checkout, /const canConfirm = Boolean\(!isOffline/);
  assert.match(checkout, /checkoutAction\.current = \(\) => \{\s*if \(isOffline\) return;/);
  assert.match(checkout, /label: isOffline \? "بانتظار الاتصال"/);
  assert.match(checkout, /disabled: isOffline \|\|/);
  assert.match(checkout, /disabled=\{isOffline \|\| mutationBusy/);
  assert.match(checkout, /disabled=\{busy \|\| isOffline\} label="تحقق واستعد الطلب"/);
});

test("network transitions do not automatically resubmit existing requests", () => {
  assert.doesNotMatch(checkout, /useEffect\(\(\) => checkout\(\), \[isOffline\]\)/);
  assert.match(checkout, /parsePendingCartCheckout\(rawAttempt, actorID, storeId\)/);
  assert.match(checkout, /readOrderForCart\(token, attempt\.cartID\)/);
});
