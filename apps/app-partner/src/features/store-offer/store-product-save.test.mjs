import assert from "node:assert/strict";
import test from "node:test";
import { reconcileStoreProductSave } from "./store-product-save.ts";

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