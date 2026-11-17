import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("marketing route presentation remains explicitly unavailable without owner contracts", () => {
  for (const filename of ["promotions-screen.tsx","store-banners.tsx","store-reels.tsx","store-design.tsx"]) {
    const source = readFileSync(resolve(import.meta.dirname, filename), "utf8");
    assert.match(source, /MerchantCapabilityScreen/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
  }
});
