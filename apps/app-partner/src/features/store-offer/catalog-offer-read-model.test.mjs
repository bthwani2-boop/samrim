import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogPublishedAvailability, getPrimaryMedia, isOfferListFilter, isOfferStockout, scopedPartnerPopularOffers, sortStoreOffersByCreation, storeOfferServerQuery } from "./catalog-offer-read-model.ts";

test("unfiltered catalog keeps its stable Store-owned page; promotions and popular are separate sources", () => {
  for (const filter of ["all", "offers", "popular"]) {
    assert.equal(storeOfferServerQuery(filter, ""), null);
  }
  assert.equal(storeOfferServerQuery("popular", "شاحن"), null);
});

test("published availability and unavailable are applied by DSH before pagination", () => {
  assert.deepEqual(storeOfferServerQuery("published", ""), { publicationState: "published", availability: "available" });
  assert.deepEqual(storeOfferServerQuery("unavailable", ""), { availability: "unavailable" });
});

test("hidden includes draft and hidden without exposing published offers", () => {
  assert.deepEqual(storeOfferServerQuery("hidden", ""), { publicationState: "not_published" });
});

test("stockout is an inventory-status query, not a local first-page calculation", () => {
  assert.deepEqual(storeOfferServerQuery("stockout", "شاحن"), { q: "شاحن", inventoryStatus: "stockout" });
});

test("search is Store-wide, normalized and bounded to DSH query limits", () => {
  assert.deepEqual(storeOfferServerQuery("all", "  شاحن  "), { q: "شاحن" });
  assert.equal(storeOfferServerQuery("all", "x".repeat(500))?.q?.length, 160);
});

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

const popularOffer = { offerId: "offer-1", storeId: "store-1", productName: "منتج موثق", publicationState: "published", availability: true };

test("partner home uses only DSH's scoped public popular ranking", () => {
  assert.deepEqual(scopedPartnerPopularOffers("store-1", { storeId: "store-1", offers: [popularOffer] }), [popularOffer]);
  assert.deepEqual(scopedPartnerPopularOffers("store-1", { storeId: "store-1", offers: [] }), []);
});

test("partner home never shows foreign or invalid offers as popular", () => {
  const failures = [
    null,
    { storeId: "store-1" },
    { storeId: "store-2", offers: [popularOffer] },
    { storeId: "store-1", offers: [{ ...popularOffer, storeId: "store-2" }] },
    { storeId: "store-1", offers: [popularOffer, popularOffer] },
    { storeId: "store-1", offers: [{ ...popularOffer, offerId: "" }] },
    { storeId: "store-1", offers: [{ ...popularOffer, productName: "" }] },
    { storeId: "store-1", offers: [{ ...popularOffer, publicationState: "draft" }] },
    { storeId: "store-1", offers: [{ ...popularOffer, availability: false }] },
    { storeId: "store-1", offers: Array.from({ length: 5 }, (_, index) => ({ ...popularOffer, offerId: "offer-" + index })) },
  ];
  for (const failure of failures) assert.equal(scopedPartnerPopularOffers("store-1", failure), null);
});


test("catalog filter routing accepts only known server modes", () => {
  for (const value of ["all", "popular", "offers", "published", "unavailable", "hidden", "stockout"]) {
    assert.equal(isOfferListFilter(value), true);
  }
  for (const value of [undefined, "", "other", "PUBLISHED", "draft", "__proto__"]) {
    assert.equal(isOfferListFilter(value), false);
  }
});

test("Store offer ordering remains deterministic across timestamps and offer IDs", () => {
  const records = [
    { offerId: "late", createdAt: "2026-11-11T12:00:01.000Z" },
    { offerId: "z", createdAt: "2026-11-11T12:00:00.123456789Z" },
    { offerId: "a", createdAt: "2026-11-11T12:00:00.123456789Z" },
    { offerId: "earlier-fraction", createdAt: "2026-11-11T12:00:00.123456788Z" },
  ];
  assert.deepEqual(sortStoreOffersByCreation(records).map((offer) => offer.offerId),
    ["earlier-fraction", "a", "z", "late"]);
  assert.equal(records[0].offerId, "late");
});

test("primary product media keeps explicit source selection and fails closed on empty URI", () => {
  const secondary = { role: "gallery", uri: "https://example.invalid/fallback.webp" };
  const primary = { role: "primary", uri: "https://example.invalid/main.webp" };
  assert.deepEqual(getPrimaryMedia([secondary, primary]), primary);
  assert.deepEqual(getPrimaryMedia([secondary]), secondary);
  assert.equal(getPrimaryMedia([]), null);
  assert.equal(getPrimaryMedia([{ ...primary, uri: "  " }, secondary]), null);
});
