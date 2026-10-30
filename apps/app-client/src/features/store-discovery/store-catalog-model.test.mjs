import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogRows, buildDisplayCatalogRows, filterCatalogToProduct,
  mergeCatalog, validateModifierSelection, isQuantityAllowed,
} from "./store-catalog-model.ts";

const alpha = { offerId: "alpha", productId: "product-a", quantityMinBaseUnits: 2, quantityMaxBaseUnits: 8, quantityStepBaseUnits: 2, modifierGroups: [] };
const beta = { offerId: "beta", productId: "product-b", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 5, quantityStepBaseUnits: 1, modifierGroups: [] };
const catalog = {
  offers: [alpha, beta],
  sections: [{ id: "visible", active: true, nameAr: "متاح", offerIds: ["alpha", "beta"] }],
  nextCursor: "page-two",
};

test("product-scoped catalog never exposes offers for another Product", () => {
  const view = filterCatalogToProduct(catalog, "product-a");
  assert.deepEqual(view.offers.map((x) => x.offerId), ["alpha"]);
  assert.deepEqual(view.sections[0].offerIds, ["alpha"]);
});

test("catalog pagination keeps first occurrence and latest cursor", () => {
  const merged = mergeCatalog({ ...catalog, offers: [alpha] }, { ...catalog, offers: [alpha, beta], nextCursor: "page-three" });
  assert.deepEqual(merged.offers.map((x) => x.offerId), ["alpha", "beta"]);
  assert.equal(merged.nextCursor, "page-three");
});

test("quantity step and modifier availability are validated", () => {
  assert.equal(isQuantityAllowed(alpha, 2), true);
  assert.equal(isQuantityAllowed(alpha, 3), false);
  assert.equal(isQuantityAllowed(alpha, 10), false);
  const selected = { ...alpha, modifierGroups: [{ id: "g", nameAr: "إضافات", minSelections: 1, maxSelections: 1, options: [{ id: "o", availability: true }, { id: "unavailable", availability: false }] }] };
  assert.equal(validateModifierSelection(selected, ["o"]), "");
  assert.notEqual(validateModifierSelection(selected, []), "");
  assert.notEqual(validateModifierSelection(selected, ["o", "o"]), "");
  assert.notEqual(validateModifierSelection(selected, ["unavailable"]), "");
});

test("catalog rows use section order and the grid transformation retains each offer", () => {
  const rows = buildCatalogRows(catalog, false, false, null, "visible", "");
  assert.deepEqual(rows.filter((x) => x.kind === "offer").map((x) => x.offer.offerId), ["alpha", "beta"]);
  const grid = buildDisplayCatalogRows(rows, true);
  assert.deepEqual(grid.filter((x) => x.kind === "grid").flatMap((x) => x.offers.map((offer) => offer.offerId)), ["alpha", "beta"]);
});
