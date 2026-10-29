import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../src/features/central-catalog/catalog-commercial-store-type-registry.tsx", import.meta.url);
const workspacePath = new URL("../src/features/central-catalog/catalog-taxonomy-workspace.tsx", import.meta.url);
const readComponent = () => readFile(componentPath, "utf8");

test("commercial store type editor is the inline Ant Design form used by the taxonomy panel", async () => {
  const [component, workspace] = await Promise.all([readComponent(), readFile(workspacePath, "utf8")]);

  assert.match(component, /import \{ Button, Checkbox, Form, Input \} from "antd"/);
  assert.match(component, /<Form form=\{form\} layout="vertical"[\s\S]*?onFinish=/);
  assert.match(component, /<Input[\s\S]*?dir="auto"/);
  assert.match(component, /<Checkbox disabled=\{busy \|\| !canEdit \|\| !vertical\?\.active\}>/);
  assert.doesNotMatch(component, /editorOnly|<Table|<Modal|<Select|listQuery|filteredTypes/);
  assert.match(workspace, /<CatalogCommercialStoreTypeRegistry verticals=\{verticals\} verticalId=\{verticalId\}[\s\S]*?initialId=\{editor\.id\} onSaved=\{refresh\} onClose=\{\(\) => setEditor\(null\)\}/);
  const typeEditor = workspace.slice(workspace.indexOf('{editor.kind === "type"'), workspace.indexOf('{editor.kind === "category"'));
  assert.doesNotMatch(typeEditor, /editorOnly/);
});

test("initial edits read the selected type from the complete vertical response including inactive types", async () => {
  const component = await readComponent();

  assert.match(component, /new URLSearchParams\(\{ verticalId, includeInactive: "true" \}\)/);
  assert.match(component, /body\.storeTypes\.find\(\(entry\) => entry\.id === typeId\)/);
  assert.match(component, /readType\(verticalId, initialId\)/);
  assert.match(component, /!vertical\?\.active/);
  assert.match(component, /state\.identity\.permissions\?\.includes\("catalog"\)/);
});

test("versioned mutations keep draft values on save failure and refresh canonical state on success", async () => {
  const component = await readComponent();

  assert.match(component, /Idempotency-Key/);
  assert.match(component, /expectedVersion: selected\.version/);
  assert.match(component, /await onSaved\?\.\(\);\s*onClose\?\.\(\);/);
  const saveBody = component.slice(component.indexOf("async function save"));
  const saveCatch = saveBody.match(/\} catch \(cause\) \{([\s\S]*?)\n    \} finally \{/);
  assert.ok(saveCatch, "save failure path should remain explicit");
  assert.match(saveCatch[1], /setError\(/);
  assert.doesNotMatch(saveCatch[1], /resetFields\(|setFieldsValue|onClose\?\.\(\)/);
});
