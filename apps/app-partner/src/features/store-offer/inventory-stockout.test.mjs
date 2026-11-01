import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogPublishedAvailability, isOfferStockout } from "./inventory-stockout.ts";

const offer = (values = {}) => ({
  publicationState: "published",
  inventoryPolicy: "QUANTITY_ON_HAND",
  inventoryOnHandBaseUnits: 8,
  inventoryReservedBaseUnits: 3,
  ...values,
});

test("tracked available stock is not exhausted", () => {
  assert.equal(isOfferStockout(offer()), false);
  assert.equal(isOfferStockout(offer({inventoryOnHandBaseUnits: 4, inventoryReservedBaseUnits: 3})), false);
});
test("zero or fully reserved stock is exhausted", () => {
  assert.equal(isOfferStockout(offer({inventoryOnHandBaseUnits: 0, inventoryReservedBaseUnits: 0})), true);
  assert.equal(isOfferStockout(offer({inventoryOnHandBaseUnits: 3, inventoryReservedBaseUnits: 3})), true);
});
test("hidden and availability-only offers never claim known stockout", () => {
  assert.equal(isOfferStockout(offer({publicationState: "hidden", inventoryOnHandBaseUnits: 0})), false);
  assert.equal(isOfferStockout(offer({inventoryPolicy: "AVAILABILITY_ONLY", inventoryOnHandBaseUnits: 0})), false);
});

test("a published available offer proves catalog readiness even when other pages exist", () => {
  assert.equal(catalogPublishedAvailability([{ publicationState: "published", availability: true }], true), true);
  assert.equal(catalogPublishedAvailability([{ publicationState: "published", availability: true }], false), true);
});

test("a partial page cannot disprove available products elsewhere in the Store", () => {
  assert.equal(catalogPublishedAvailability([{ publicationState: "hidden", availability: false }], true), null);
  assert.equal(catalogPublishedAvailability([], true), null);
});

test("a complete page with no published available offers is definitively not ready", () => {
  assert.equal(catalogPublishedAvailability([{ publicationState: "draft", availability: true }], false), false);
  assert.equal(catalogPublishedAvailability([], false), false);
  assert.equal(catalogPublishedAvailability(null, false), null);
});
