import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildDisplayCatalogRows } from "../src/features/store-discovery/store-catalog-model.ts";

const featurePath = path.resolve(import.meta.dirname, "../src/features/store-discovery/store-detail.tsx");
const detail = readFileSync(featurePath, "utf8");

const offer = (id) => ({ kind: "offer", key: "offer:" + id, offer: { offerId: id } });

test("desktop store grid preserves headings while grouping real offers", () => {
  const rows = [offer("one"), offer("two"), offer("three"), { kind: "heading", key: "group-two", title: "مجموعة", subtitle: "" }, offer("four"), offer("five")];
  const grouped = buildDisplayCatalogRows(rows, true, 3);
  assert.deepEqual(grouped.map((row) => row.kind), ["grid", "heading", "grid"]);
  assert.deepEqual(grouped[0].offers.map((item) => item.offerId), ["one", "two", "three"]);
  assert.deepEqual(grouped[2].offers.map((item) => item.offerId), ["four", "five"]);
});

test("wide desktop storefront groups four products without stretching the last incomplete row", () => {
  const grouped = buildDisplayCatalogRows(
    [offer("one"), offer("two"), offer("three"), offer("four"), offer("five"), offer("six")],
    true,
    4,
  );
  assert.deepEqual(grouped.map((row) => row.offers.map((item) => item.offerId)), [
    ["one", "two", "three", "four"],
    ["five", "six"],
  ]);
  assert.match(detail, /"empty-grid-cell:5"/);
});

test("failed media falls back truthfully and a new media URL is eligible to load", () => {
  assert.match(detail, /failedProductImageURIs\.has\(primaryMedia\.uri\)/);
  assert.match(detail, /new Set\(current\)\.add\(primaryMedia\.uri\)/);
  assert.match(detail, /صورة غير متوفرة/);
});

test("existing mobile two-column grid remains the default when explicitly selected", () => {
  const grouped = buildDisplayCatalogRows([offer("one"), offer("two"), offer("three")], true);
  assert.deepEqual(grouped.map((row) => row.kind), ["grid", "grid"]);
  assert.equal(grouped[0].offers.length, 2);
  assert.equal(grouped[1].offers.length, 1);
});

test("responsive desktop store defaults to existing grid without overriding the user's toggle", () => {
  assert.match(detail, /const gridMode = userGridMode \?\? \(Platform\.OS === "web" && windowWidth >= 1024\)/);
  assert.match(detail, /const gridColumns = Platform\.OS !== "web" \? 2 : windowWidth >= 1700 \? 5 : windowWidth >= 1200 \? 4 : windowWidth >= 1024 \? 3 : 2/);
  assert.match(detail, /setUserGridMode\(!gridMode\)/);
});
