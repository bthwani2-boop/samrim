import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../src/features/central-catalog/catalog-shopping-shortcut-registry.tsx", import.meta.url);
const workspacePath = new URL("../src/features/central-catalog/catalog-taxonomy-workspace.tsx", import.meta.url);
const readComponent = () => readFile(componentPath, "utf8");

test("shopping shortcut is one inline Ant Design editor in the canonical taxonomy panel", async () => {
  const [component, workspace] = await Promise.all([readComponent(), readFile(workspacePath, "utf8")]);

  assert.match(component, /import \{ Button, Checkbox, Form, Input, InputNumber \} from "antd"/);
  assert.match(component, /export function CatalogShoppingShortcutEditor/);
  assert.doesNotMatch(component, /editorOnly|RegistryColumnHeader|<table|catalog-registry-table|listQuery|listStatus|filteredShortcuts/);
  assert.match(workspace, /<CatalogShoppingShortcutEditor[\s\S]*?verticalId=\{verticalId\}[\s\S]*?initialShortcut=\{shortcutToEdit\}/);
  assert.match(workspace, /const refreshShortcut = useCallback\(async \(saved: ShoppingShortcut\)/);
  assert.match(workspace, /current\.version < saved\.version/);
  assert.doesNotMatch(workspace, /CatalogShoppingShortcutRegistry|editorOnly initialId=\{editor\.id\} onSaved=\{refresh\} onClose=/);
});

test("save preserves the DSH payload, version, authorization, endpoint and idempotency contract", async () => {
  const component = await readComponent();

  assert.match(component, /state\.identity\.permissions\?\.includes\("catalog"\)/);
  assert.match(component, /if \(!canEdit \|\| !verticalId \|\| busy\) return/);
  assert.match(component, /initialShortcut\s*\? `\/api\/catalog\/shopping-shortcuts\/\$\{encodeURIComponent\(initialShortcut\.id\)\}`\s*: "\/api\/catalog\/shopping-shortcuts"/);
  assert.match(component, /method: initialShortcut \? "PATCH" : "POST"/);
  assert.match(component, /"Idempotency-Key": idempotency\.current\.key/);
  for (const field of [
    /verticalId/,
    /titleAr: cleanTitle/,
    /ordinal: values\.ordinal/,
    /active: values\.active/,
    /expectedVersion: initialShortcut\?\.version \?\? 0/,
    /storeTypeIds: \[\.\.\.typeIds\]/,
    /categoryIds: \[\.\.\.categoryIds\]/,
    /reason,/,
  ]) {
    assert.match(component, field);
  }
  assert.match(component, /if \(!response\.ok \|\| !payload\?\.shortcut\) throw new Error\(errorMessage\(payload\)\)/);
  assert.match(component, /await onSaved\(payload\.shortcut\);\s*if \(life === lifeSequence\.current\) onClose\(\)/);
});

test("Arabic validation and negative paths bound all fields and preserve failed drafts", async () => {
  const component = await readComponent();

  assert.match(component, /min: 2, max: 160/);
  assert.match(component, /Number\.isInteger\(values\.ordinal\).*values\.ordinal < 0 \|\| values\.ordinal > 9999/);
  assert.match(component, /reason\.length < 5 \|\| reason\.length > 500/);
  assert.match(component, /targetCount === 0 \|\| targetCount > 25/);
  assert.match(component, /if \(nextCount > 25 && nextCount > currentCount\)/);
  assert.match(component, /setSelectionError\("اختر نوع متجر أو فئة واحدة على الأقل\."\)/);
  assert.match(component, /catch \(cause: unknown\)[\s\S]*?setSaveError\(/);
  assert.doesNotMatch(component, /form\.resetFields\(\)|form\.setFieldsValue\(/);
  assert.match(component, /<Form form=\{form\} hidden=\{loading \|\| Boolean\(loadError\)\}/);
  assert.match(component, /lifeSequence\.current \+= 1/);
  assert.match(component, /\}, \[verticalId\]\)/);
  assert.match(component, /request !== requestSequence\.current/);
});
test("editing a missing shortcut fails closed and scope changes cannot reinstate stale readback", async () => {
  const workspace = await readFile(workspacePath, "utf8");
  assert.match(workspace, /const shortcutToEdit = editor\?\.kind === "shortcut" && editor\.id/);
  assert.match(workspace, /editor\.id && !shortcutToEdit/);
  assert.match(workspace, /initialShortcut=\{shortcutToEdit\}/);
  assert.match(workspace, /const request = scopeRequest\.current/);
  assert.match(workspace, /if \(request !== scopeRequest\.current\) throw new Error\(/);
  assert.match(workspace, /تعذر العثور على الاختصار المحدد/);
});

test("category choices stay bounded, searchable, cursor-backed, and recoverable", async () => {
  const component = await readComponent();

  assert.match(component, /async function readCategoryPage\(verticalId: string, search: string, cursor/);
  assert.match(component, /status: "all", sort: "name_asc", limit: "50"/);
  assert.match(component, /query\.set\("query", search\.trim\(\)\)/);
  assert.match(component, /if \(cursor\) query\.set\("cursor", cursor\)/);
  assert.doesNotMatch(component, /for \(let page = 0; page < 100/);
  assert.match(component, /api\/catalog\/categories\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(component, /onSearch=\{\(value\) => void loadCategoryPage\(value\)\}/);
  assert.match(component, /onChange=\{\(event\) => \{ setCategoryQuery\(event.target.value\); setCategoryCursor\(""\); \}\}/);
  assert.match(component, /categoryCursor \? <Button[\s\S]*?loadCategoryPage\(categoryQuery, categoryCursor, true\)/);
  assert.match(component, /categoryError \? <p role="alert"[\s\S]*?categoryRetry\.current/);
  assert.match(component, /categories\.length === 0 \? <p role="status"/);
  assert.match(component, /categoryRequestSequence\.current \+= 1/);
});
