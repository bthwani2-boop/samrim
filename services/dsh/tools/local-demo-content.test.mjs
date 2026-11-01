import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../demo/local-content");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const arabic = /[\u0600-\u06FF]/u;
const assertArabic = (value, label) => {
  assert.equal(typeof value, "string", label);
  assert.match(value, arabic, label);
  assert.doesNotMatch(value, /\?{2,}/u, label);
};

test("catalog matches canonical shared-import fields and symbolic references", () => {
  const scenario = JSON.parse(read("catalog-scenario.json"));
  const rows = read("shared-products.import-template.jsonl").trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(scenario.locale, "ar-YE");
  assert.equal(scenario.currency, "YER");
  assert.equal(scenario.categories.length, 4);
  assert.equal(scenario.sharedProducts.length, 5);
  assert.equal(rows.length, scenario.sharedProducts.length);
  const categoryKeys = new Set(scenario.categories.map(({ key }) => key));
  const productKeys = new Set(scenario.sharedProducts.map(({ key }) => key));
  for (const [i, row] of rows.entries()) {
    const product = scenario.sharedProducts[i];
    assert.equal(row.scope, "SHARED");
    assert.match(row.verticalId, /^replace-with-canonical-/u);
    assert.deepEqual(row.categoryIds, [`MAP:${product.categoryKey}`]);
    assert.ok(categoryKeys.has(product.categoryKey));
    assert.equal(row.canonicalName, product.nameAr);
    assert.equal(row.variantTitle, product.variantTitle);
    assert.equal(row.measurementKind, product.measurementKind);
    assert.equal(row.baseUnit, product.baseUnit);
    assert.ok(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"].includes(row.measurementKind));
    assert.ok(["COUNT", "GRAM", "MILLILITER"].includes(row.baseUnit));
    assert.equal(row.storeId, undefined);
    assert.equal(row.imageUri, undefined);
  }
  for (const entry of scenario.storeAssortment) assert.ok(productKeys.has(entry.productKey));
});

test("store CSV uses supported headers, positive integer YER prices and Arabic", () => {
  const [header, ...lines] = read("store-offers.import.csv").trim().split(/\r?\n/u);
  assert.deepEqual(header.split(","), ["name", "variant", "unit", "price"]);
  assert.equal(lines.length, 5);
  for (const line of lines) {
    const [name, variant, unit, price, extra] = line.split(",");
    assert.equal(extra, undefined);
    assertArabic(name, "CSV product");
    assertArabic(variant, "CSV variant");
    assert.ok(["piece", "gram", "milliliter"].includes(unit));
    assert.match(price, /^[1-9][0-9]*$/u);
  }
});

test("Arabic names and descriptions survive UTF-8 serialization", () => {
  const scenario = JSON.parse(read("catalog-scenario.json"));
  assertArabic(scenario.storeNameAr, "Store");
  assertArabic(scenario.cityAr, "City");
  assertArabic(scenario.descriptionAr, "Description");
  for (const c of scenario.categories) assertArabic(c.nameAr, c.key);
  for (const p of scenario.sharedProducts) {
    assertArabic(p.nameAr, p.key);
    assertArabic(p.variantTitle, p.key);
  }
  for (const offer of scenario.storeAssortment) {
    for (const variant of offer.variantScenarios) assertArabic(variant, offer.productKey);
  }
  for (const row of read("shared-products.import-template.jsonl").trim().split(/\r?\n/u).map(JSON.parse)) {
    assertArabic(row.canonicalName, "Shared product");
    assertArabic(row.variantTitle, "Shared variant");
  }
  for (const draft of JSON.parse(read("promotion-drafts.json"))) {
    assertArabic(draft.nameAr, "Promotion name");
    assertArabic(draft.descriptionAr, "Promotion description");
  }
});

test("promotion examples remain drafts with unresolved owner references and dates", () => {
  const promotions = JSON.parse(read("promotion-drafts.json"));
  assert.equal(promotions.length, 2);
  assert.deepEqual(promotions.map(({ kind }) => kind).sort(), ["FIXED", "PERCENTAGE"]);
  for (const promotion of promotions) {
    assert.equal(promotion.fundingSource, "PARTNER");
    assert.match(promotion.startsAt, /^REPLACE_/u);
    assert.match(promotion.endsAt, /^REPLACE_/u);
  }
  assert.match(promotions[0].targets[0].targetRef, /^MAP:/u);
});

test("ten canonical PNG media files are valid and keep their safe SVG originals", () => {
  const scenario = JSON.parse(read("catalog-scenario.json"));
  const assets = [
    ...scenario.categories.map(({ image }) => image),
    ...scenario.sharedProducts.map(({ image }) => image),
    scenario.storeCoverImage,
  ];
  assert.equal(assets.length, 10);
  assert.equal(new Set(assets).size, assets.length);
  for (const asset of assets) {
    assert.match(asset, /^images\/[a-z0-9-]+\.png$/u);
    const file = fs.readFileSync(path.join(root, asset));
    assert.ok(file.length > 100 && file.length <= 10 * 1024 * 1024);
    assert.equal(file.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(file.toString("ascii", 12, 16), "IHDR");
    assert.equal(file.readUInt32BE(16), 960);
    assert.equal(file.readUInt32BE(20), 720);
    const svg = read(asset.replace(/\.png$/u, ".svg"));
    assert.match(svg, /<svg\b/u);
    assert.match(svg, /<title/u);
    assert.doesNotMatch(svg, /(?:href|src)=["'](?:https?:)?\/\//iu);
    assert.doesNotMatch(svg, /<script\b|<image\b|<foreignObject\b/iu);
  }
});
