import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { dshOperations } from "@bthwani/dsh";

const source = filename => readFileSync(resolve(import.meta.dirname, filename), "utf8");

test("connected Store profile uses the canonical owner contract instead of a placeholder", () => {
  assert.deepEqual(dshOperations.getMerchantStoreProfile, { method: "GET", path: "/v1/stores/{storeID}/profile" });
  assert.deepEqual(dshOperations.changeMerchantStoreProfile, { method: "PATCH", path: "/v1/stores/{storeID}/profile" });
  const profile = source("store-profile.tsx");
  assert.match(profile, /from "\.\/store-profile-transport"/);
  assert.doesNotMatch(profile, /MerchantCapabilityScreen|\bfetch\s*\(|\bsetItem\s*\(/);
});
