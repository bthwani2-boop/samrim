import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const componentPath = fileURLToPath(new URL("../src/features/partners/partner-detail-workspace.tsx", import.meta.url));
const source = await readFile(componentPath, "utf8");
const ast = ts.createSourceFile(componentPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function descendants(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node);
  ts.forEachChild(node, child => { descendants(child, predicate, matches); });
  return matches;
}

const helper = descendants(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === "isCurrentPartnerStoresRequest")[0];
assert.ok(helper, "store pagination freshness predicate remains with the feature owner");
const compiledHelper = ts.transpileModule(helper.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const helperModule = { exports: {} };
vm.runInNewContext(compiledHelper, { exports: helperModule.exports, module: helperModule });
const isCurrent = helperModule.exports.isCurrentPartnerStoresRequest;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function guardedPage(request, current, operation, state) {
  const currentRequest = () => isCurrent(request, current.current.generation, current.current.actorId);
  try {
    const page = await operation;
    if (!currentRequest()) return;
    state.stores = page.stores;
    state.cursor = page.nextCursor ?? "";
    state.pageStack = page.pageStack;
  } catch (error) {
    if (!currentRequest()) return;
    state.error = error.message;
    state.stores = [];
    state.cursor = "";
  } finally {
    if (currentRequest()) state.loading = false;
  }
}

test("older page success cannot replace the selected cursor page", async () => {
  const oldResponse = deferred();
  const latestResponse = deferred();
  const current = { current: { generation: 1, actorId: "partner-a" } };
  const state = { stores: [{ id: "first-page" }], cursor: "old-next", pageStack: [""], error: "", loading: true };
  const oldRequest = { ...current.current };
  const oldDone = guardedPage(oldRequest, current, oldResponse.promise, state);
  current.current = { generation: 2, actorId: "partner-a" };
  const latestRequest = { ...current.current };
  const latestDone = guardedPage(latestRequest, current, latestResponse.promise, state);

  latestResponse.resolve({ stores: [{ id: "latest-page" }], nextCursor: "latest-next", pageStack: ["", "latest"] });
  await latestDone;
  oldResponse.resolve({ stores: [{ id: "stale-page" }], nextCursor: "stale-next", pageStack: [""] });
  await oldDone;

  assert.deepEqual(Array.from(state.stores, store => store.id), ["latest-page"]);
  assert.equal(state.cursor, "latest-next");
  assert.deepEqual(Array.from(state.pageStack), ["", "latest"]);
  assert.equal(state.error, "");
  assert.equal(state.loading, false);
});

test("stale failure cannot clear the current page or end its loading state", async () => {
  const oldResponse = deferred();
  const latestResponse = deferred();
  const current = { current: { generation: 4, actorId: "partner-a" } };
  const state = { stores: [{ id: "current-page" }], cursor: "current-next", pageStack: [""], error: "", loading: true };
  const oldDone = guardedPage({ ...current.current }, current, oldResponse.promise, state);
  current.current = { generation: 5, actorId: "partner-a" };
  const latestDone = guardedPage({ ...current.current }, current, latestResponse.promise, state);

  oldResponse.reject(new Error("obsolete request failed"));
  await oldDone;
  assert.deepEqual(Array.from(state.stores, store => store.id), ["current-page"]);
  assert.equal(state.error, "");
  assert.equal(state.loading, true);

  latestResponse.resolve({ stores: [{ id: "readback-page" }], nextCursor: "", pageStack: [""] });
  await latestDone;
  assert.deepEqual(Array.from(state.stores, store => store.id), ["readback-page"]);
  assert.equal(state.loading, false);
});

test("actor scope and generation both participate in request freshness", () => {
  assert.equal(isCurrent({ generation: 9, actorId: "partner-a" }, 9, "partner-a"), true);
  assert.equal(isCurrent({ generation: 8, actorId: "partner-a" }, 9, "partner-a"), false);
  assert.equal(isCurrent({ generation: 9, actorId: "partner-a" }, 9, "partner-b"), false);
});

test("component guards success, failure, and loading writes for its current actor and page", () => {
  assert.equal(ast.parseDiagnostics.length, 0, "component parses as TypeScript TSX");
  const loadStores = descendants(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadStores")[0];
  assert.ok(loadStores && ts.isCallExpression(loadStores.initializer));
  const loader = loadStores.initializer.arguments[0];
  assert.ok(ts.isArrowFunction(loader));
  const body = loader.body;
  const bodyText = body.getText(ast);
  assert.ok(bodyText.includes("generation: ++storesRequestGeneration.current, actorId"));
  assert.ok(bodyText.includes("const isCurrent = () => isCurrentPartnerStoresRequest(request, storesRequestGeneration.current, storesRequestActorId.current)"));
  assert.ok(bodyText.includes("if (!isCurrent()) return;\n      setStores(page.stores)"));
  assert.ok(bodyText.includes("} catch (cause) {\n      if (!isCurrent()) return;"));
  assert.ok(bodyText.includes("finally { if (isCurrent()) setLoadingStores(false); }"));
  assert.ok(source.includes("if (storesRequestActorId.current !== actorId)"));
  assert.ok(source.includes("storesRequestGeneration.current++"));
});
