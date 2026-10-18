import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx"), "utf8");
const ast = ts.createSourceFile("store-discovery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "uniqueNearbyAddress");
assert.ok(helper, "single-address selection must use the canonical home discovery implementation");
const compiled = ts.transpileModule(helper.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const select = vm.runInNewContext(compiled + "\nuniqueNearbyAddress", { Number });

const address = (id, serviceCityId, latitude = 15.36, longitude = 44.19) => ({ id, serviceCityId, latitude, longitude });

test("single usable saved address selects nearest without extra chooser", () => {
  const match = address("a", "sanaa");
  assert.equal(select([match], "sanaa", ""), match);
  assert.equal(select([address("aden", "aden"), match], "sanaa", ""), match);
});
test("two valid addresses never pick an arbitrary delivery destination", () => {
  assert.equal(select([address("a", "sanaa"), address("b", "sanaa")], "sanaa", ""), null);
});
test("pagination never assumes the first page is complete", () => {
  assert.equal(select([address("a", "sanaa")], "sanaa", "next-cursor"), null);
});
test("other cities and missing coordinates never become the nearest origin", () => {
  assert.equal(select([address("a", "aden")], "sanaa", ""), null);
  assert.equal(select([address("a", "sanaa", NaN)], "sanaa", ""), null);
  assert.equal(select([], "sanaa", ""), null);
});
