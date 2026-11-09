import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const detail = readFileSync(new URL("../src/features/store-discovery/store-detail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-detail.tsx", detail, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function productionReturnAction(router) {
  let action;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "returnToStores") action = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(action, "Store detail must expose one canonical return action");
  const source = ts.transpileModule(`${action.getText(ast)}; returnToStores;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(source, { router });
}

test("ready public Store shows an accessible return-to-stores control in the hero toolbar", () => {
  const readyUI = detail.slice(detail.indexOf('accessibilityLabel={\`كتالوج ${state.store.name}\`}'));
  assert.ok(readyUI.length > 2000, "inspect the actual ready Store render");
  assert.match(readyUI, /<BthwaniIconButton icon="home" label="العودة إلى المتاجر" onPress=\{returnToStores\}/);
  assert.match(readyUI, /<BthwaniIconButton icon="share" label="مشاركة المتجر"/);
});

test("direct-entry and in-app Store return use the deterministic home route without relying on history", () => {
  const visited = [];
  const handler = productionReturnAction({
    replace: (route) => visited.push(["replace", route]),
    back: () => { throw new Error("direct-entry Store may not have history"); },
  });
  handler();
  handler();
  assert.deepEqual(visited, [["replace", "/home"], ["replace", "/home"]]);
});

test("unavailable and transient-error Store states use the same route as ready Store", () => {
  const fallback = detail.slice(detail.indexOf('if (state.kind === "unavailable")'), detail.indexOf('const heroImageURI ='));
  const match = fallback.match(/<BthwaniButton label="العودة إلى المتاجر" onPress=\{returnToStores\} variant="secondary" \/>/g);
  assert.equal(match?.length, 2);
  assert.equal(detail.match(/router\.replace\("\/home" as Href\)/g)?.length, 1, "do not duplicate routing rules");
});
