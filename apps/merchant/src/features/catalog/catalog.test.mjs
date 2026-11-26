import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("catalog route presentation remains explicitly unavailable without owner contracts", () => {
  for (const filename of ["products-screen.tsx","product-editor.tsx","quick-prices.tsx","product-media.tsx"]) {
    const source = readFileSync(resolve(import.meta.dirname, filename), "utf8");
    assert.match(source, /MerchantCapabilityScreen/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
  }
});

test("CSV preflight stays read-only until the DSH import run is implemented", () => {
  const source = readFileSync(resolve(import.meta.dirname, "catalog-import.tsx"), "utf8");
  assert.match(source, /readMerchantCatalogPage\(storeId, actorId, signal/);
  assert.match(source, /readCatalogCsv\(file, signal\)/);
  assert.doesNotMatch(source, /submitMerchantCatalog|\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
});
