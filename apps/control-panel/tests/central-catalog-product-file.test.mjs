import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../src/features/central-catalog/central-catalog.tsx", import.meta.url);

test("each product row opens its existing adaptive product file from an accessible action", async () => {
  const component = await readFile(componentPath, "utf8");

  assert.match(component, /<th scope="col">ملف المنتج<\/th>/);
  assert.match(component, /className="button button-secondary catalog-row-action"[\s\S]*?data-adaptive-record-trigger=\{`catalog-product-\$\{product\.id\}`\}[\s\S]*?disabled=\{detailLoading\}[\s\S]*?aria-expanded=\{detailProductId === product\.id && editorOpen\}[\s\S]*?aria-label=\{`فتح ملف المنتج \$\{product\.canonicalName\}`\}[\s\S]*?selectProduct\(product\.id\)[\s\S]*?>ملف المنتج<\/button>/);
  assert.equal((component.match(/<td colSpan=\{8\} className="catalog-table-state">/g) ?? []).length, 2);
  assert.match(component, /<AdaptiveRecordPanel/);
  assert.match(component, /<AdaptiveRecordWorkspace preferenceKey="catalog-products"/);
  assert.match(component, /categoryIds/);
  assert.match(component, /source/);
  assert.match(component, /catalog-mobile-open[\s\S]*?>ملف المنتج<\/button>/);
});