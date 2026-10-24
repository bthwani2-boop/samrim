import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reelDestinationLabel, resolvedDiscoveryDestination } from "../src/features/store-discovery/discovery-reel-destination.ts";

const target = (targetType, targetId, storeId) => ({
  contentId: "reel-id", targetType, targetId, storeId,
  promotionId: targetType === "PROMOTION" ? targetId : null,
});

test("one context-aware CTA, no CTA for informational videos", () => {
  assert.equal(reelDestinationLabel("STORE"), "زيارة المتجر");
  assert.equal(reelDestinationLabel("PRODUCT"), "عرض المنتج");
  assert.equal(reelDestinationLabel("PROMOTION"), "شاهد العرض");
  assert.equal(reelDestinationLabel("CATEGORY"), "استكشف المنتجات");
  assert.equal(reelDestinationLabel("INFO"), null);
});

test("a product reel navigates to the original Store product route", () => {
  assert.equal(
    resolvedDiscoveryDestination(target("PRODUCT", "rice-special", "store-one")),
    "/store/store-one?productId=rice-special",
  );
});

test("a Store reel uses the Store page, not a reel-local shop", () => {
  assert.equal(resolvedDiscoveryDestination(target("STORE", "store-one", "store-one")), "/store/store-one");
});

test("Store offers and categories link to the original Store destination", () => {
  assert.equal(resolvedDiscoveryDestination(target("PROMOTION", "offer-1", "store-one")), "/store/store-one?promotionId=offer-1");
  assert.equal(resolvedDiscoveryDestination(target("CATEGORY", "cat-1", "store-one")), "/store/store-one?categoryId=cat-1");
});

test("malformed or unavailable routes never invent a destination", () => {
  assert.equal(resolvedDiscoveryDestination(target("INFO", "", null)), null);
  assert.equal(resolvedDiscoveryDestination(target("PRODUCT", "rice", null)), null);
  assert.equal(resolvedDiscoveryDestination(target("PROMOTION", "", "store-one")), null);
});

test("deep link identifiers are encoded rather than inserted into route syntax", () => {
  assert.equal(
    resolvedDiscoveryDestination(target("PRODUCT", "a&b", "store/with space")),
    "/store/store%2Fwith%20space?productId=a%26b",
  );
});

test("removed reel-local product and cart code cannot reappear in client entry points", () => {
  const root = fileURLToPath(new URL("../src/features/store-discovery/", import.meta.url));
  const page = readFileSync(new URL("../src/features/store-discovery/store-discovery.tsx", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../src/features/store-discovery/discovery-reels-viewer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /DiscoveryReelShop|reelProduct|onRequireLogin/);
  assert.doesNotMatch(viewer, /addCatalogOfferToCart|quantityBaseUnits|selectedOptionIds|StoreProductSheet/);
  assert.match(viewer, /onIndexChange/);
  assert.match(viewer, /resumeSeconds/);
});
