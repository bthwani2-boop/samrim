import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("catalog route presentation remains explicitly unavailable without owner contracts", () => {
  for (const filename of ["products-screen.tsx","product-editor.tsx","quick-prices.tsx","inventory-summary.tsx","catalog-import.tsx","catalog-export.tsx","product-media.tsx"]) {
    const source = readFileSync(resolve(import.meta.dirname, filename), "utf8");
    assert.match(source, /MerchantCapabilityScreen/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
  }
});
