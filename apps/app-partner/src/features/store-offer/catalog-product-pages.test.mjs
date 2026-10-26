import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatalogProductPage } from "./catalog-product-pages.ts";

test("appending a repeated product page does not duplicate catalog records", () => {
  const first = [{ id: "one" }, { id: "two" }];
  const repeated = [{ id: "two" }, { id: "three" }];
  assert.deepEqual(mergeCatalogProductPage(first, repeated, true), [
    { id: "one" }, { id: "two" }, { id: "three" },
  ]);
  assert.deepEqual(first, [{ id: "one" }, { id: "two" }]);
});

test("a fresh catalog search replaces earlier pages", () => {
  assert.deepEqual(mergeCatalogProductPage([{ id: "stale" }], [{ id: "fresh" }], false), [{ id: "fresh" }]);
});
