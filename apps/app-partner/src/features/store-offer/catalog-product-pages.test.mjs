import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentCatalogProductRequest, mergeCatalogProductPage, reconcileStoreProductSave, releaseCatalogProductPageRequest, replaceCatalogProductInPage } from "./catalog-product-pages.ts";

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

test("saving a product replaces its stale search result without changing other products", () => {
  const current = [{ id: "one", canonicalName: "Old name" }, { id: "two", canonicalName: "Keep" }];
  const saved = { id: "one", canonicalName: "Saved name", version: 2 };

  assert.deepEqual(replaceCatalogProductInPage(current, saved), [saved, current[1]]);
  assert.deepEqual(current, [{ id: "one", canonicalName: "Old name" }, { id: "two", canonicalName: "Keep" }]);
});

test("a save result for another product leaves the search page unchanged", () => {
  const current = [{ id: "one", canonicalName: "Keep" }];

  assert.deepEqual(replaceCatalogProductInPage(current, { id: "other", canonicalName: "Unsaved draft" }), current);
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

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("late save reconciles its catalog record without replacing a newer product selection", async () => {
  const request = deferred();
  const catalog = new Map();
  let selectedProductID = "product-a";
  let editorName = "Edited A";

  const saving = request.promise.then((product) => reconcileStoreProductSave(
    "product-a",
    product,
    selectedProductID,
    (saved) => catalog.set(saved.id, saved),
    (saved) => { selectedProductID = saved.id; editorName = saved.canonicalName; },
  ));

  selectedProductID = "product-b";
  editorName = "Product B";
  request.resolve({ id: "product-a", canonicalName: "Saved A" });

  assert.equal(await saving, false);
  assert.equal(catalog.get("product-a").canonicalName, "Saved A");
  assert.equal(selectedProductID, "product-b");
  assert.equal(editorName, "Product B");
});

test("current save updates the selected editor from the canonical response", () => {
  let editorName = "Draft name";
  const reconciled = reconcileStoreProductSave(
    "product-a",
    { id: "product-a", canonicalName: "Canonical name" },
    "product-a",
    () => {},
    (product) => { editorName = product.canonicalName; },
  );

  assert.equal(reconciled, true);
  assert.equal(editorName, "Canonical name");
});
