import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx"), "utf8");
const ast = ts.createSourceFile("store-discovery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("store sorting and category navigation use one horizontal, same-sized chip row", () => {
  const rows = [];
  function walk(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "ScrollView" &&
        node.attributes.getText(ast).includes('accessibilityLabel="تصفية المتاجر والفئات"')) {
      rows.push(node.parent.getText(ast));
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.equal(rows.length, 1, "a single shared filter row must exist");
  const row = rows[0];
  assert.match(row, /\bhorizontal\b/);
  for (const label of ["كل المتاجر", "الأحدث", "الأقرب", "المفضلة"]) {
    assert.ok(row.includes(`label="${label}"`), `missing sort: ${label}`);
  }
  assert.match(row, /\{categoryTabs\}/, "category filters belong in that same scroll row");
});

test("category root, ancestors and children render identically sized chips without old image tiles", () => {
  assert.match(source, /const categoryTabs = selectedVertical \? <>/);
  assert.doesNotMatch(source, /<BthwaniChip label="كل فئات المنتجات"/);
  assert.match(source, /taxonomy\.trail\.map\(\(category, index\) => <BthwaniChip/);
  assert.match(source, /taxonomy\.children\.map\(\(category\) => <BthwaniChip/);
  assert.doesNotMatch(source, /styles\.categoryTile/);
});

test("product search still exposes category choices, independently of store sorting", () => {
  assert.match(source, /searchScope === "products" && searchIsActive && categoryTabs/);
  assert.match(source, /accessibilityLabel="تصفية المنتجات حسب الفئة"/);
  assert.match(source, /onPress=\{\(\) => selectCategory\(category\.id\)\}/);
});
