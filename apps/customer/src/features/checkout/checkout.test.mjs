import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("checkout cannot submit requests or payments before DSH/WLT owner integration", () => {
  const source = readFileSync(new URL("./checkout-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /checkout-confirmation-unavailable/);
  assert.match(source, /readVerifiedCart\(storeId,/);
  assert.match(source, /useFocusEffect/);
  assert.doesNotMatch(source, /createOrder\(|fetch\(|charge\(|walletDebit\(/);
});
