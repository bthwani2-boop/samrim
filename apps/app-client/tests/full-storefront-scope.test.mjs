import assert from "node:assert/strict";
import { test } from "node:test";

import * as storefront from "../src/features/store-discovery/full-storefront-model.ts";
const { visiblePublishedOffers, verifiedMarketplaceStoreRead, storefrontColumns } = storefront;

const store = {
  id: "partner-a",
  name: "متجر أ",
  publishedAt: "2026-11-08T10:00:00Z",
  serviceCity: { id: "sanaa", active: true },
};
const catalog = { storeId: "partner-a", offers: [], categories: [], sections: [], nextCursor: null };

test("a public website read must match the requested Store and active City", () => {
  assert.equal(verifiedMarketplaceStoreRead(store, catalog, "partner-a", "sanaa"), true);
  assert.equal(verifiedMarketplaceStoreRead(store, catalog, "partner-b", "sanaa"), false);
  assert.equal(verifiedMarketplaceStoreRead(store, catalog, "partner-a", "aden"), false);
  assert.equal(verifiedMarketplaceStoreRead({ ...store, serviceCity: { id: "sanaa", active: false } }, catalog, "partner-a", "sanaa"), false);
  assert.equal(verifiedMarketplaceStoreRead({ ...store, publishedAt: "" }, catalog, "partner-a", "sanaa"), false);
  assert.equal(verifiedMarketplaceStoreRead(store, { ...catalog, storeId: "partner-b" }, "partner-a", "sanaa"), false);
});

test("never display drafts, hidden or cross-Store offers even when a response is contaminated", () => {
  const offer = { offerId: "one", storeId: "partner-a", productActive: true, variantActive: true, publicationState: "published" };
  assert.deepEqual(
    visiblePublishedOffers([
      offer,
      { ...offer, offerId: "draft", publicationState: "draft" },
      { ...offer, offerId: "hidden", publicationState: "hidden" },
      { ...offer, offerId: "other-store", storeId: "partner-b" },
      { ...offer, offerId: "inactive", variantActive: false },
    ], "partner-a").map((item) => item.offerId),
    ["one"],
  );
});

test("web layout keeps responsive card counts at approved viewport widths", () => {
  assert.equal(storefrontColumns(390), 2);
  assert.equal(storefrontColumns(768), 3);
  assert.equal(storefrontColumns(1360), 4);
  assert.equal(storefrontColumns(320), 1);
});

test("Full Storefront links stay in the site and encode product and category scope", () => {
  assert.equal(storefront.buildFullStorefrontPath("partner-a", "sanaa", { productID: "product&1" }),
    "/storefront/partner-a?serviceCityId=sanaa&productId=product%261");
  assert.equal(storefront.buildFullStorefrontPath("partner-a", "sanaa", { categoryID: "cat/1" }),
    "/storefront/partner-a?serviceCityId=sanaa&categoryId=cat%2F1");
});

test("a shared site uses its active linked city without changing the saved marketplace city", () => {
  const cities = [{ id: "sanaa", active: true }, { id: "aden", active: true }, { id: "inactive", active: false }];
  assert.equal(storefront.resolveFullStorefrontCityID("sanaa", "aden", cities), "sanaa");
  assert.equal(storefront.resolveFullStorefrontCityID("", "aden", cities), "aden");
  assert.equal(storefront.resolveFullStorefrontCityID("inactive", "aden", cities), null);
  assert.equal(storefront.resolveFullStorefrontCityID("foreign", "aden", cities), null);
});

test("a product page never substitutes another product or a withdrawn variant", () => {
  const offer = { offerId: "one", storeId: "partner-a", productId: "product-1", productActive: true, variantActive: true, publicationState: "published" };
  const alternatives = [
    offer,
    { ...offer, offerId: "two", productId: "product-2" },
    { ...offer, offerId: "draft", publicationState: "draft" },
    { ...offer, offerId: "foreign", storeId: "partner-b" },
  ];
  assert.deepEqual(visiblePublishedOffers(alternatives, "partner-a", "product-1").map(item => item.offerId), ["one"]);
  assert.deepEqual(visiblePublishedOffers(alternatives, "partner-a", "missing"), []);
});
