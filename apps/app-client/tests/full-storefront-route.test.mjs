import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const app = path.resolve(import.meta.dirname, "..");
const site = readFileSync(path.join(app, "src/features/store-discovery/full-storefront.tsx"), "utf8");
const route = readFileSync(path.join(app, "app/storefront/[storeId].tsx"), "utf8");
const market = readFileSync(path.join(app, "app/store/[storeId].tsx"), "utf8");
const marketDetail = readFileSync(path.join(app, "src/features/store-discovery/store-detail.tsx"), "utf8");
const cityScope = readFileSync(path.join(app, "src/features/service-city/service-city-scope.tsx"), "utf8");

test("web route is a separate composition, never the existing marketplace or independent owner preview", () => {
  assert.match(route, /Platform\.OS !== "web"/);
  assert.match(route, /ClientFullStorefront storeId=\{storeId\}/);
  assert.match(route, /index: false/);
  assert.match(route, /Redirect href=\{path as Href\}/);
  assert.match(market, /ClientStoreDetail/);
  assert.match(marketDetail, /زيارة موقع المتجر الكامل/);
  assert.match(cityScope, /pathname\.startsWith\("\/storefront\/"\)/);
  assert.doesNotMatch(site + route, /independent-preview|ReadIndependentStorePreview|CreateIndependentPickupOrder/);
});

test("web site reads the canonical public Store, scoped catalog and Store-owned banners", () => {
  assert.match(site, /readPublishedStore\(storeId, selectedCityID\)/);
  assert.match(site, /readPublicStoreCatalog\(storeId, selectedCityID/);
  assert.match(site, /verifiedMarketplaceStoreRead\(store, catalog, storeId, selectedCityID\)/);
  assert.match(site, /visiblePublishedOffers\(ready\.catalog\.offers, storeId\)/);
  assert.match(site, /listPublicStoreBanners\(storeId, selectedCityID\)/);
  assert.match(site, /StorePublicContactCard storeID=\{storeId\}/);
  assert.doesNotMatch(site, /createDshMobileClient|fetch\(|checkout\(|addCatalogOfferToCart|calculatePrice/);
  assert.match(site, /const hideWithdrawnStore = useCallback/);
  assert.ok((site.match(/storeReadFailureKind\(cause\) === "unavailable"/g) ?? []).length >= 3, "public revocation during banners, filters and pagination must hide cached Store");
});

test("store site offers explicit retry, no-results and themed responsive layout", () => {
  assert.match(site, /setCatalogError\(true\)/);
  assert.match(site, /label="إعادة قراءة المنتجات"/);
  assert.match(site, /label="إعادة قراءة البنرات"/);
  assert.match(site, /لا توجد منتجات منشورة للعرض حاليًا/);
  assert.match(site, /لا توجد نتائج مطابقة/);
  assert.match(site, /storefrontColumns\(width\)/);
  assert.match(site, /useAppearanceTheme\(\)/);
  assert.match(site, /role="main"/);
});

test("a newer category filter must clear pending pagination before the stale page resolves", () => {
  // Pagination and filters share catalogID. A category tab remains clickable
  // while a page is loading. Once it supersedes the page, the old page's
  // generation-gated finally cannot clear loadingMore, so the filter must.
  const filter = site.split("const applyFilter = useCallback")[1]?.split("const loadMore = useCallback")[0] ?? "";
  assert.match(filter, /const generation = \+\+catalogID\.current;\s*setLoadingMore\(false\);\s*setCatalogBusy\(true\);/);
  const loadMore = site.split("const loadMore = useCallback")[1] ?? "";
  assert.match(loadMore, /if \(generation !== catalogID\.current\) return;/);
});

test("web product cards expose a real browser anchor to the existing Marketplace route", () => {
  // A role=link Pressable without href is JS-only: no copy/open-in-new-tab.
  assert.match(site, /import \{[^}]*\bLink\b[^}]*\} from "expo-router"/);
  assert.match(site, /<Link key=\{offer\.offerId\} href=\{marketplacePath\(offer\.productId\)\} asChild>/);
  assert.match(site, /<Pressable accessibilityRole="link" accessibilityLabel=\{"عرض "/);
  assert.doesNotMatch(site, /onPress=\{\(\) => router\.push\(marketplacePath\(offer\.productId\)\)\}/);
});
