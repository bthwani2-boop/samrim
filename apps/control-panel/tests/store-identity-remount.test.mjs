import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

function keyedStoreElement(source, tagName) {
  const parsed = ts.createSourceFile("store-scope.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(parsed.parseDiagnostics.length, 0, "the store route parses");
  let element;
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(parsed) === tagName) {
      element = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(element, `${tagName} is still rendered by its canonical owner`);
  const attribute = name => element.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === name);
  const scopeKey = attribute("key");
  const scopeValue = attribute("storeId");
  assert.ok(scopeKey && scopeValue, `${tagName} must be keyed and receive the Store scope`);
  assert.ok(ts.isJsxExpression(scopeKey.initializer));
  assert.ok(ts.isJsxExpression(scopeValue.initializer));
  assert.ok(scopeKey.initializer.expression && scopeValue.initializer.expression);
  assert.equal(scopeKey.initializer.expression.getText(parsed), scopeValue.initializer.expression.getText(parsed),
    "changing storeId must remount the editor and discard prior Store state before paint");
}

test("partner inspector uses the Store ID as the React identity for the entire Store detail subtree", () => {
  const source = readFileSync(new URL("../src/features/partner-onboarding/partners-workbench.tsx", import.meta.url), "utf8");
  keyedStoreElement(source, "StoreInspector");
});

test("standalone Store workspace remounts when the route Store ID changes", () => {
  const source = readFileSync(new URL("../app/(workspace)/partners/stores/[storeId]/page.tsx", import.meta.url), "utf8");
  keyedStoreElement(source, "StoreWorkspace");
});

test("a Store detail component without a matching key must fail the scope guard", () => {
  assert.throws(() => keyedStoreElement('const view = <StoreInspector storeId={selectedStoreId} />;', "StoreInspector"));
  assert.throws(() => keyedStoreElement('const view = <StoreWorkspace key={oldStoreId} storeId={storeId} />;', "StoreWorkspace"));
});
