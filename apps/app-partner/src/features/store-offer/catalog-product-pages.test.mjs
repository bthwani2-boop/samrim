import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentCatalogProductRequest, mergeCatalogProductPage, releaseCatalogProductPageRequest } from "./catalog-product-pages.ts";

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

test("a newer fresh search invalidates an older append response", () => {
  const appendSequence = 4;
  const freshSearchSequence = 5;
  assert.equal(isCurrentCatalogProductRequest(appendSequence, freshSearchSequence), false);
  assert.equal(isCurrentCatalogProductRequest(freshSearchSequence, freshSearchSequence), true);
});

test("a stale append completion cannot unlock a newer append", () => {
  assert.equal(releaseCatalogProductPageRequest(8, 7), 8);
  assert.equal(releaseCatalogProductPageRequest(8, 8), null);
});
