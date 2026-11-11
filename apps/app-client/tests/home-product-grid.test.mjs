import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const feed = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/home-product-feed.tsx"), "utf8");

test("mobile feed uses three columns at 360dp, keeps two on narrower phones and scales on web", () => {
  assert.match(feed, /width >= 1050 \? 5 : width >= 720 \? 4/);
  assert.match(feed, /width >= 540 \|\| \(Platform\.OS !== "web" && width >= 360\)/);
  assert.match(feed, /\? 3 : 2/);
  assert.doesNotMatch(feed, /width >= 320 \? 3/);
  assert.match(feed, /photoBox: \{ aspectRatio: 1,/);
});

test("product prices use contrast-safe semantic text rather than bright brand orange", () => {
  assert.match(feed, /price: \{ \.\.\.typography\.bodyStrong, color: theme\.interactiveText/);
});

test("product actions are siblings of the product navigation button", () => {
  const openOffer = feed.indexOf('<Pressable accessibilityRole="button" accessibilityLabel={`عرض ${offer.productName}');
  const closeOffer = feed.indexOf("</Pressable>", openOffer);
  const overlay = feed.indexOf('<View pointerEvents="box-none" style={styles.photoActions}>', openOffer);
  const addToCart = feed.indexOf('accessibilityLabel={`إضافة ${offer.productName}', openOffer);
  const reduceQuantity = feed.indexOf('accessibilityLabel={`تقليل كمية ${offer.productName}', openOffer);
  assert.ok(openOffer >= 0 && closeOffer > openOffer);
  assert.ok(overlay > closeOffer && addToCart > overlay && reduceQuantity > overlay);
  assert.ok(feed.includes('photoActions: { position: "absolute", top: 0, left: 0, right: 0, aspectRatio: 1 }'));
});

const discovery = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx"), "utf8");

test("typed product search reuses the DSH-backed grid, cart actions, and server cursor", () => {
  assert.match(feed, /export function ProductSearchResults[\s\S]*?<HomeProductFeed/);
  assert.match(discovery, /<ProductSearchResults/);
  assert.doesNotMatch(discovery, /function ProductSearchResults/);
  assert.match(discovery, /query=\{query\}/);
  assert.doesNotMatch(discovery, /setProductSearch\(/);
  assert.match(feed, /const normalizedQuery = query\.trim\(\)/);
  assert.match(feed, /searchPublicCatalog\(cityID, normalizedQuery, categoryID, effectivePageSize/);
  assert.match(feed, /searchPublicCatalog\(cityID, normalizedQuery, categoryID, PAGE_SIZE, state\.nextCursor/);
  assert.match(feed, /adjustSimpleOfferQuantity\(offer\.storeId, offer, direction, sessionKey\)/);
  assert.match(feed, /const sessionKey = currentHomeSessionKey\(\)/);
});

test("empty product search offers real catalog-based suggestions with an explicit retry", () => {
  assert.match(feed, /searchPublicCatalog\(selectedCityID, "", selectedCategoryID, 24, cursor/);
  assert.match(feed, /const seen = new Set<string>\(\)/);
  assert.match(feed, /if \(name && !seen\.has\(name\)\)/);
  assert.match(feed, /if \(index === 0 \|\| names\.length === 0\) throw error/, "failed pages without usable suggestions must expose retry while earlier valid names remain");
  assert.match(feed, /اقتراح البحث عن/);
  assert.match(feed, /onSearchQueryChange\(name\)/);
  assert.match(feed, /إعادة تحميل الاقتراحات/);
});

test("read-only browser price-sort test validates empty and invalid prices before single-offer skip", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "./client-discovery-browser.manual.mjs"), "utf8");
  const empty = source.indexOf("PRICE_SORT_EMPTY_RESULT");
  const invalid = source.indexOf("PRICE_SORT_INVALID_SERVER_PRICES");
  const single = source.indexOf("if (payload.offers.length < 2) return false");
  assert.ok(empty >= 0 && invalid > empty && single > invalid, "empty and malformed prices are failures even when fewer than two offers return");
});
