import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const feed = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/home-product-feed.tsx"), "utf8");

test("mobile feed uses two legible columns; tablet and desktop scale without forcing three on phones", () => {
  assert.match(feed, /width >= 1050 \? 5 : width >= 720 \? 4 : width >= 540 \? 3 : 2/);
  assert.doesNotMatch(feed, /width >= 350 \? 3/);
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
