import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("multi-Store checkout remains unavailable without owner orchestration", () => {
  const source = readFileSync(new URL("./multi-store-checkout-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /CapabilityUnavailableScreen/);
  assert.doesNotMatch(source, /createOrder\(|fetch\(|payment\(/);
});
