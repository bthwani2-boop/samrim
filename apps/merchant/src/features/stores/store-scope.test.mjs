import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { dshOperations } from "@bthwani/dsh";

const source = filename => readFileSync(resolve(import.meta.dirname, filename), "utf8");

// Unconnected presentation remains fail-closed. Connected capabilities have
// separate behavioral renderer and transport suites rather than placeholders.
test("unconnected Store capabilities remain explicitly unavailable without owner contracts", () => {
  for (const filename of ["store-scope.tsx", "store-selector.tsx", "store-overview.tsx", "operating-hours.tsx", "store-access.tsx", "captain-memberships.tsx"]) {
    const content = source(filename);
    assert.match(content, /MerchantCapabilityScreen/, filename);
    assert.doesNotMatch(content, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/, filename);
  }
});

test("connected Store profile uses the canonical owner contract instead of a placeholder", () => {
  assert.deepEqual(dshOperations.getMerchantStoreProfile, { method: "GET", path: "/v1/stores/{storeID}/profile" });
  assert.deepEqual(dshOperations.changeMerchantStoreProfile, { method: "PATCH", path: "/v1/stores/{storeID}/profile" });
  const profile = source("store-profile.tsx");
  assert.match(profile, /from "\.\/store-profile-transport"/);
  assert.doesNotMatch(profile, /MerchantCapabilityScreen|\bfetch\s*\(|\bsetItem\s*\(/);
});
