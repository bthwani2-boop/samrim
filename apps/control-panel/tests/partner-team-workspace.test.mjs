import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const componentPath = fileURLToPath(new URL("../src/features/partners/partner-team-workspace.tsx", import.meta.url));
const source = await readFile(componentPath, "utf8");
const ast = ts.createSourceFile(componentPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function visit(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => visit(child, predicate));
}

function descendants(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node);
  ts.forEachChild(node, child => { descendants(child, predicate, matches); });
  return matches;
}

function identifiers(node) {
  return descendants(node, ts.isIdentifier).map(item => item.text);
}

function propertyNames(array) {
  return array.elements.map(item => item.getText(ast).replaceAll('"', ""));
}

const helper = visit(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === "isCurrentPartnerTeamRequest");
const appendHelper = visit(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === "appendUniquePartnerTeamItems");
assert.ok(helper, "request generation predicate is declared");
const compiledHelper = ts.transpileModule(helper.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const helperModule = { exports: {} };
vm.runInNewContext(compiledHelper, { exports: helperModule.exports, module: helperModule });
const isCurrent = helperModule.exports.isCurrentPartnerTeamRequest;
const compiledAppendHelper = ts.transpileModule(appendHelper.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const appendModule = { exports: {} };
vm.runInNewContext(compiledAppendHelper, { exports: appendModule.exports, module: appendModule });
const appendUnique = appendModule.exports.appendUniquePartnerTeamItems;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function guardedCompletion(requestGeneration, currentGeneration, operation, state) {
  return operation.then(
    value => {
      if (isCurrent(requestGeneration, currentGeneration())) state.items = appendUnique(state.items, value);
    },
    error => {
      if (isCurrent(requestGeneration, currentGeneration())) state.error = error.message;
    },
  ).finally(() => {
    if (isCurrent(requestGeneration, currentGeneration())) state.loading = false;
  });
}

test("out-of-order completion from the previous owner cannot append or set current error/loading", async () => {
  const oldResponse = deferred();
  const newResponse = deferred();
  let generation = 4;
  const state = { items: [{ id: "new-owner-existing" }], error: "", loading: true };
  const oldDone = guardedCompletion(4, () => generation, oldResponse.promise, state);
  generation = 5;
  const newDone = guardedCompletion(5, () => generation, newResponse.promise, state);

  newResponse.resolve([{ id: "new-owner-page" }]);
  await newDone;
  oldResponse.reject(new Error("old owner failed"));
  await oldDone;

  assert.deepEqual(Array.from(state.items, item => item.id), ["new-owner-existing", "new-owner-page"]);
  assert.equal(state.error, "");
  assert.equal(state.loading, false);
});

test("latest page appends new grants and removes overlap with existing and repeated page ids", () => {
  const existing = [{ id: "one" }, { id: "two" }];
  const appended = appendUnique(existing, [{ id: "two" }, { id: "three" }, { id: "three" }]);
  assert.deepEqual(Array.from(appended, item => item.id), ["one", "two", "three"]);
});

test("older page success cannot overwrite a newer page, while the latest generation remains writable", async () => {
  const older = deferred();
  const latest = deferred();
  let generation = 10;
  const state = { items: [{ id: "first-page" }] };
  const olderDone = guardedCompletion(10, () => generation, older.promise, state);
  generation = 11;
  const latestDone = guardedCompletion(11, () => generation, latest.promise, state);

  latest.resolve([{ id: "latest-page" }]);
  await latestDone;
  older.resolve([{ id: "stale-page" }]);
  await olderDone;

  assert.deepEqual(Array.from(state.items, item => item.id), ["first-page", "latest-page"]);
});

test("component invalidates generations for owner/store/reload/unmount and guards all load-more outcomes", () => {
  assert.equal(ast.parseDiagnostics.length, 0, "component parses as TypeScript TSX");
  const layoutEffect = descendants(ast, node => ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect")[0];
  assert.ok(layoutEffect, "layout cleanup invalidates requests before a changed scope can paint");
  const layoutCallback = layoutEffect.arguments[0];
  const dependencies = layoutEffect.arguments[1];
  assert.ok(ts.isArrowFunction(layoutCallback));
  assert.ok(ts.isArrayLiteralExpression(dependencies));
  assert.deepEqual(propertyNames(dependencies), ["ownerId", "storeId", "compact", "revision"]);
  assert.ok(identifiers(layoutCallback).includes("requestGeneration"));
  const beforePaintResets = new Set(descendants(layoutCallback, ts.isCallExpression).map(call => call.expression.getText(ast)));
  for (const setter of ["setItems", "setCounts", "setCursor", "setError", "setLoading", "setLoadingMore"]) {
    assert.ok(beforePaintResets.has(setter), `${setter} is cleared before a different owner's roster can paint`);
  }

  const loadMore = visit(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadMore");
  assert.ok(loadMore && ts.isArrowFunction(loadMore.initializer));
  const body = loadMore.initializer.body;
  assert.ok(ts.isBlock(body));
  const first = body.statements[0];
  assert.ok(ts.isIfStatement(first));
  assert.ok(identifiers(first.expression).includes("compact"), "compact mode returns before any request");
  const callPositions = descendants(body, ts.isCallExpression)
    .filter(call => call.expression.getText(ast) === "identityFetch")
    .map(call => call.getStart(ast));
  assert.equal(callPositions.length, 1);
  assert.ok(first.getStart(ast) < callPositions[0]);

  const guards = descendants(body, node => ts.isCallExpression(node) && node.expression.getText(ast) === "isCurrentPartnerTeamRequest");
  assert.ok(guards.length >= 5, "generation guards cover response, functional state updates, error, and finally");
  const setterNames = new Set(descendants(body, ts.isCallExpression).map(call => call.expression.getText(ast)));
  for (const setter of ["setItems", "setCounts", "setCursor", "setError", "setLoadingMore"]) {
    assert.ok(setterNames.has(setter), `${setter} remains owned by guarded pagination`);
  }

  const paginationItems = descendants(body, node => ts.isCallExpression(node) && node.expression.getText(ast) === "setItems")[0];
  assert.match(paginationItems.getText(ast), /appendUniquePartnerTeamItems\(previous,page\.items\)/);
  assert.match(source, /new URLSearchParams\(\{limit:compact\?"3":"25"\}\)/, "compact first page remains limited to three and pagination remains 25");
});