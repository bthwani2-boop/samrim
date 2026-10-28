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
test("product editor shows core identity first and progressively discloses optional metadata", async () => {
  const component = await readFile(componentPath, "utf8");
  const editor = component.slice(component.indexOf('<div className="central-product-form">'), component.indexOf('</AdaptiveRecordPanel>'));
  const vertical = editor.indexOf('id="catalog-vertical"');
  const name = editor.indexOf('id="catalog-product-name"');
  const description = editor.indexOf('id="catalog-product-description"');
  const category = editor.indexOf('className="catalog-product-category-picker"');
  const advanced = editor.indexOf('className="catalog-product-advanced"');
  const brand = editor.indexOf('id="catalog-product-brand"');
  const media = editor.indexOf('className="catalog-product-media-gallery"');
  assert.ok(vertical >= 0 && vertical < name && name < description && description < category, "the next core entry is available before category details");
  assert.ok(category < advanced && advanced < brand && brand < media, "optional metadata does not hide taxonomy, required attributes or media");
  assert.ok(editor.includes('<details className="catalog-product-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>'));
  assert.match(editor, /id="catalog-measurement-kind"/);
  assert.match(editor, /id="catalog-base-unit"/);
  assert.match(editor, /id="catalog-identifier-value"/);
  assert.match(component, /const saveProductDisabled = busy \\|\\| versionConflict[\\s\\S]*!form\\.canonicalName\\.trim\\(\\)[\\s\\S]*!form\\.verticalId[\\s\\S]*form\\.categoryIds\\.length === 0/);
  assert.match(component, /"X-Expected-Version"/);
  assert.match(component, /"Idempotency-Key"/);
});
