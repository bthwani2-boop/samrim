import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("unconnected Store capabilities remain explicitly unavailable without owner contracts", () => {
  for (const filename of ["store-scope.tsx","store-selector.tsx","store-overview.tsx","store-profile.tsx","operating-hours.tsx","store-access.tsx","captain-memberships.tsx"]) {
    const source = readFileSync(resolve(import.meta.dirname, filename), "utf8");
    assert.match(source, /MerchantCapabilityScreen/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
  }
});
