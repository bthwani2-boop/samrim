import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const app = path.resolve(import.meta.dirname, "..");
const site = readFileSync(path.join(app, "src/features/store-discovery/full-storefront.tsx"), "utf8");
const route = readFileSync(path.join(app, "app/storefront/[storeId].tsx"), "utf8");
const market = readFileSync(path.join(app, "app/store/[storeId].tsx"), "utf8");
const marketDetail = readFileSync(path.join(app, "src/features/store-discovery/store-detail.tsx"), "utf8");
const cityScope = readFileSync(path.join(app, "src/features/service-city/service-city-scope.tsx"), "utf8");
const cartRoute = readFileSync(path.join(app, "app/cart/[storeId].tsx"), "utf8");
const cart = readFileSync(path.join(app, "src/features/cart-checkout/client-cart-screen.tsx"), "utf8");
const browserProof = readFileSync(path.join(app, "tests/full-storefront-browser.manual.mjs"), "utf8");

test("web route is a separate composition, never the existing marketplace or independent owner preview", () => {
  assert.match(route, /Platform\.OS !== "web"/);
  assert.match(route, /ClientFullStorefront\s+storeId=\{storeId\}/);
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
  assert.match(site, /visiblePublishedOffers\(ready\.catalog\.offers, storeId, productID\)/);
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

test("broken Store banner media falls back without hiding its approved content", () => {
  assert.match(site, /const bannerUri = banner\.mediaUri \?\? ""/);
  assert.match(site, /bannerUri && !brokenImages\.has\(bannerUri\)/);
  assert.match(site, /setBrokenImages\(\(previous\) => new Set\(previous\)\.add\(bannerUri\)\)/);
  assert.match(site, /صورة البنر غير متوفرة/);
});

test("manual browser proof stays inside the authorized Chrome CDP context", () => {
  assert.match(browserProof, /browser\.contexts\(\)\[0\]/);
  assert.doesNotMatch(browserProof, /browser\.newContext\(/);
  assert.match(browserProof, /await page\.close\(\)/);
  assert.doesNotMatch(browserProof, /await context\.close\(\)/);
  assert.match(browserProof, /process\.exitCode = 2/, "missing approved Store must block positive E2E proof");
  assert.match(browserProof, /assert\.deepEqual\(errors, \[\]/, "browser errors must fail the journey");
});

test("a newer search clears pagination and route scope changes discard pending reads", () => {
  // The search field can submit while a page is loading. The superseded
  // request's generation-gated finally cannot clear loadingMore.
  const filter = site.split("const applyFilter = useCallback")[1]?.split("const loadMore = useCallback")[0] ?? "";
  assert.match(filter, /const generation = \+\+catalogID\.current;\s*setLoadingMore\(false\);\s*setCatalogBusy\(true\);/);
  const loadMore = site.split("const loadMore = useCallback")[1] ?? "";
  assert.match(loadMore, /if \(generation !== catalogID\.current\) return;/);
  assert.match(route, /key=\{JSON\.stringify\(\[storeId, cityID, categoryID, productID, query\]\)\}/);
});

test("web product and category links stay in the Full Storefront and purchasing hands off to Marketplace", () => {
  // A role=link Pressable without href is JS-only: no copy/open-in-new-tab.
  assert.match(site, /import \{[^}]*\bLink\b[^}]*\} from "expo-router"/);
  assert.match(site, /<Link key=\{offer\.offerId\} href=\{storefrontPath\(\{ productID: offer\.productId \}\)\} asChild>/);
  assert.match(site, /href=\{storefrontPath\(\{ categoryID: category\.id, query \}\)\}/);
  assert.match(site, /<Pressable accessibilityRole="link" accessibilityLabel=\{"عرض "/);
  assert.match(site, /readPublicStoreCatalog\(storeId, selectedCityID, categoryID, initialQuery, 24, "", productID\)/);
  assert.match(site, /readPublicStoreCatalog\(storeId, selectedCityID, categoryID, appliedQuery, 24, cursor, productID\)/);
  assert.match(site, /openMarketRoute\(marketplacePath\(productID\)\)/);
  assert.match(site, /openMarketRoute\(clientStorefrontCartPath\(storeId, selectedCityID \?\? "", productID\) as Href\)/);
});

test("a signed-out marketplace shopper keeps the exact product and the storefront cart keeps its return scope", () => {
  assert.match(marketDetail, /requireAuthentication\(offer\.productId\)/);
  assert.match(marketDetail, /encodeURIComponent\(returnTo\)/);
  assert.match(cartRoute, /authReturnPath: storefront\.returnPath/);
  assert.match(cart, /buildFullStorefrontPath\(storeId, storefront\.cityID, \{ productID: storefront\.productID \}\)/);
  assert.match(cart, /<CartCheckout key=/);
});

test("retrying a failed catalog page keeps the same Store cursor instead of resetting earlier results", () => {
  const filter = site.split("const applyFilter = useCallback")[1]?.split("const loadMore = useCallback")[0] ?? "";
  const page = site.split("const loadMore = useCallback")[1]?.split("  const ready = ")[0] ?? "";
  assert.match(site, /const catalogRetryOrigin = useRef<"filter" \| "page">\("filter"\)/);
  assert.match(site, /const catalogRetrySearch = useRef\(initialQuery\)/);
  assert.match(filter, /catalogRetrySearch\.current = search\.trim\(\)/);
  assert.match(site, /catalogRetrySearch\.current = initialQuery/);
  assert.match(filter, /catalogRetryOrigin\.current = "filter"/);
  assert.match(page, /catalogRetryOrigin\.current = "page"/);
  assert.match(page, /const cursor = state\.catalog\.nextCursor/);
  assert.match(page, /readPublicStoreCatalog\(storeId, selectedCityID, categoryID, appliedQuery, 24, cursor, productID\)/);
  assert.match(page, /if \(generation !== catalogID\.current\) return;/);
  assert.match(page, /mergeCatalog\(previous\.catalog, next\)/);
  assert.match(site, /onPress=\{\(\) => catalogRetryOrigin\.current === "page" \? void loadMore\(\) : void applyFilter\(catalogRetrySearch\.current\)\}/);
  assert.doesNotMatch(site, /onPress=\{\(\) => productID \? void loadMore\(\) : void applyFilter\(query\)\}/);
});

test("the actual catalog error retry handler selects the failed page, not an unsent search", () => {
  const errorAction = site.split('label="إعادة قراءة المنتجات" onPress=')[1] ?? "";
  const expression = errorAction.match(/^\{\(\) => ([^}]+)\} variant="secondary"/)?.[1];
  assert.ok(expression, "extract the source-owned retry callback from the rendered error action");
  const invoke = (origin) => {
    const calls = [];
    const onRetry = runInNewContext("() => (" + expression + ")", {
      catalogRetryOrigin: { current: origin },
      query: "draft not submitted",
      catalogRetrySearch: { current: "actually submitted query" },
      loadMore: () => { calls.push("retry-page"); },
      applyFilter: (value) => { calls.push("filter:" + value); },
    });
    onRetry();
    return calls;
  };
  assert.deepEqual(invoke("page"), ["retry-page"], "a failed nextCursor page must not reset the catalog");
  assert.deepEqual(invoke("filter"), ["filter:actually submitted query"], "retry repeats the failed submitted request, never an unsent draft");
});
