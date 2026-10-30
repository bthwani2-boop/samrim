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
