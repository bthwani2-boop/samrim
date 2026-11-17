import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("finance route presentation remains explicitly unavailable without owner contracts", () => {
  for (const filename of ["wallet-screen.tsx","earnings-summary.tsx","commercial-agreement.tsx","payout-recipients.tsx"]) {
    const source = readFileSync(resolve(import.meta.dirname, filename), "utf8");
    assert.match(source, /MerchantCapabilityScreen/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
  }
});
