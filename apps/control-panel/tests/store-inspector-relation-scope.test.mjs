import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-inspector.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-inspector.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let guard;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "supportedStoreRelation") guard = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(guard, "canonical inspector must define its response-scope guard");
const compiled = ts.transpileModule(guard.getText(ast) + "\nsupportedStoreRelation;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const supported = runInNewContext(compiled, { exports: {} });

test("the real Store inspector guard admits only both canonical relation models", () => {
  assert.equal(supported("BTHWANI_PARTNER"), true);
  assert.equal(supported("INDEPENDENT_STORE"), true);
  for (const unknown of ["", "PARTNER", "MARKETPLACE", "UNKNOWN", null, undefined, 0, {}, []]) {
    assert.equal(supported(unknown), false, "unknown relation must be denied");
  }
});

test("untrusted Store GET is checked before old Store state becomes visible", () => {
  assert.match(source, /result\.store\?\.id !== storeId \|\| !supportedStoreRelation\(result\.store\.relationModel\)/);
  assert.match(source, /setStore\(result\.store\);/);
  assert.match(source, /setStore\(null\);/);
});

test("publication POST refuses a response with changed or unknown relation", () => {
  assert.match(source, /result\.store\?\.id !== store\.id \|\| !supportedStoreRelation\(result\.store\.relationModel\)/);
  assert.match(source, /nextState === "published" && result\.store\.relationModel !== "BTHWANI_PARTNER"/);
});
