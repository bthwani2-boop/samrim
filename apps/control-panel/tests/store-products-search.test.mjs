import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-products-workspace.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("store-products-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(parsed.parseDiagnostics.length, 0, "the Store products workspace parses");

function latestRequestPredicate() {
  let predicate;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isCurrentSharedCatalogRequest") predicate = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(predicate, "the request freshness predicate remains in the workspace owner");
  return runInNewContext(ts.transpile(`(${predicate.getText(parsed)})`, { target: ts.ScriptTarget.ES2022 }));
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("only the newest shared catalog response can replace results after out-of-order completion", async () => {
  const isCurrent = latestRequestPredicate();
  let active = { version: 1, storeId: "store-a" };
  const olderRequest = { ...active };
  const older = deferred();
  const olderCompletion = older.promise.then(value => {
    if (isCurrent(olderRequest, active)) results = value;
  });

  active = { version: 2, storeId: "store-a" };
  const newerRequest = { ...active };
  const newer = deferred();
  let results = [];
  const newerCompletion = newer.promise.then(value => {
    if (isCurrent(newerRequest, active)) results = value;
  });

  newer.resolve(["new query result"]);
  await newerCompletion;
  older.resolve(["stale query result"]);
  await olderCompletion;

  assert.deepEqual(results, ["new query result"]);
  assert.equal(isCurrent(olderRequest, active), false);
});

test("current cursor page remains applicable while stale page and Store scope responses are rejected", () => {
  const isCurrent = latestRequestPredicate();
  const current = { version: 8, storeId: "store-b" };
  const currentPage = { version: 8, storeId: "store-b" };
  const stalePage = { version: 7, storeId: "store-b" };
  const priorStore = { version: 8, storeId: "store-a" };

  assert.equal(isCurrent(currentPage, current), true);
  assert.equal(isCurrent(stalePage, current), false);
  assert.equal(isCurrent(priorStore, current), false);
});

test("component guards result, error, and loading updates with the same request freshness check", () => {
  assert.match(source, /if\(!isCurrent\(\)\)return;[\s\S]*setShared\(current=>append\?/);
  assert.match(source, /catch\(e\)\{if\(isCurrent\(\)\)setError/);
  assert.match(source, /finally\{if\(isCurrent\(\)\)setSharedLoading\(false\)\}/);
  assert.match(source, /if\(sharedSearchStoreId\.current!==storeId\)\{sharedSearchStoreId\.current=storeId;sharedSearchVersion\.current\+\+;\}/);
});
