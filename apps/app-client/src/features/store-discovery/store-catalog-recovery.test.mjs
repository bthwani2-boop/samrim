import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCatalogRows } from "./store-catalog-model.ts";

const emptyCatalog = { offers: [], sections: [], nextCursor: null };
const emptyTitle = (options = {}) => buildCatalogRows(
  emptyCatalog,
  options.favorites ?? false,
  options.popular ?? false,
  options.category ?? null,
  null,
  options.query ?? "",
)[0]?.title;

test("a text search with no matches does not claim the Store has no products", () => {
  assert.equal(emptyTitle({ query: "unmatched product" }), "لا توجد منتجات مطابقة للبحث");
  assert.equal(emptyTitle({ category: "category-1", query: "unmatched product" }), "لا توجد منتجات مطابقة للبحث");
});

test("a category with no offers explains the selected filter", () => {
  assert.equal(emptyTitle({ category: "category-1" }), "لا توجد منتجات ضمن هذه الفئة حاليًا");
  assert.equal(emptyTitle(), "لا توجد منتجات متاحة حاليًا");
});

test("popularity, favorites, and curated section empty states preserve their semantics", () => {
  assert.equal(emptyTitle({ popular: true, category: "category-1" }), "لا توجد منتجات رائجة في هذا التصنيف خلال آخر 30 يومًا");
  assert.equal(emptyTitle({ favorites: true }), "لم تحفظ منتجات من هذا المتجر بعد");
  const section = { id: "section-1", active: true, nameAr: "مختارات", offerIds: [] };
  assert.equal(buildCatalogRows({ ...emptyCatalog, sections: [section] }, false, false, null, section.id, "")[0]?.title, "لا توجد منتجات متاحة في مختارات حاليًا");
});

test("Store empty results have one accessible, scoped way back to the full catalog", () => {
  const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
  assert.match(source, /label="عرض جميع منتجات المتجر"/);
  assert.match(source, /onPress=\{\(\) => void reloadCatalog\(null, "", false, false\)\}/);
  assert.match(source, /disabled=\{catalogRefreshing\}/);
});
