import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-branches-preview.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-branches-preview.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0, "operator branches source must parse");

let validator;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "isValidStoreBranchesPage") validator = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(validator, "production Store branch pagination must validate the response before rendering it");
const compiled = ts.transpileModule(validator.getText(ast) + "\nisValidStoreBranchesPage;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const isValid = runInNewContext(compiled, { exports: {}, Set });

const store = (id = "store-1") => ({
  id, name: "متجر", publicationState: "unpublished",
  serviceCityName: "صنعاء", primaryVerticalName: "مقاضي",
});

test("valid Store branches page preserves canonical Store identity and cursor", () => {
  assert.equal(isValid({ stores: [store()], nextCursor: "cursor-2" }), true);
  assert.equal(isValid({ stores: [], nextCursor: "" }), true);
  assert.equal(isValid({ stores: [store("store-2")] }), true);
});

test("error payload, malformed cursor, and missing Store identity fail closed", () => {
  for (const input of [
    null, {}, { error: { code: "FORBIDDEN" } },
    { stores: null }, { stores: [], nextCursor: 42 },
    { stores: [null] }, { stores: [{ id: "store-1" }] },
    { stores: [store("")] }, { stores: [store("  ")] },
    { stores: [store("store-1"), store("store-1")] },
    { stores: [{ ...store(), publicationState: "UNKNOWN" }] },
    { stores: [{ ...store(), name: {} }] },
  ]) assert.equal(isValid(input), false, JSON.stringify(input));
});

test("actor and current Store changes remount the entire pagination history", () => {
  assert.match(source, /<StoreBranchesList key=\{JSON\.stringify\(\[actorId, currentStoreId\]\)\}/);
  assert.match(source, /function StoreBranchesList\(/);
  assert.match(source, /\[actorId, cursor, retry\]/);
});

test("failed owner page rejects stale content and next cursor while retaining same-page recovery", () => {
  assert.match(source, /if \(!isValidStoreBranchesPage\(result\)\) throw new Error\(/);
  assert.match(source, /setStores\(\[\]\);\s*setNext\(""\);\s*setError\(/);
  assert.match(source, /setRetry\(\(n\) => n \+ 1\)/);
  assert.match(source, /disabled=\{loading \|\| Boolean\(error\) \|\| !next\}/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
});

function productionBranchEffect() {
  let callback;
  function visitEffect(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && !callback) callback = node.arguments[0];
    ts.forEachChild(node, visitEffect);
  }
  visitEffect(ast);
  assert.ok(callback, "Store branch page must have the production read effect");
  const code = ts.transpileModule("const branchEffect = " + callback.getText(ast) + "; branchEffect;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return code;
}

function branchEffectHarness(plans) {
  const state = { stores: [store("prior")], next: "old-next", error: "", loading: false };
  const fetches = [];
  const context = {
    actorId: "actor-a", cursor: "", retry: 0,
    AbortController, URLSearchParams, encodeURIComponent,
    setLoading: (value) => { state.loading = value; },
    setError: (value) => { state.error = value; },
    setStores: (value) => { state.stores = value; },
    setNext: (value) => { state.next = value; },
    isValidStoreBranchesPage: isValid,
    identityFetch: async (url, init) => {
      fetches.push({ url, signal: init.signal });
      const plan = plans.shift();
      assert.ok(plan, "unexpected second Store branches request");
      if (plan.hold) await new Promise((resolve) => { plan.release = resolve; });
      return plan.response;
    },
  };
  const effect = runInNewContext(productionBranchEffect(), context);
  return { effect, context, state, fetches };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("actual scoped read effect removes stale next-page navigation on 403 and recovers with retry", async () => {
  const h = branchEffectHarness([
    { response: { ok: true, json: async () => ({ stores: [store("one")], nextCursor: "page-2" }) } },
    { response: { ok: false, status: 403 } },
    { response: { ok: true, json: async () => ({ stores: [store("two")], nextCursor: "" }) } },
  ]);
  let cleanup = h.effect();
  await settle();
  assert.deepEqual(h.state.stores.map((item) => item.id), ["one"]);
  assert.equal(h.state.next, "page-2");
  cleanup();

  h.context.cursor = "page-2";
  cleanup = h.effect();
  await settle();
  assert.equal(h.state.stores.length, 0, "old branch rows may not survive a failed new page");
  assert.equal(h.state.next, "", "failed page cannot keep a next cursor from earlier response");
  assert.match(h.state.error, /صلاحية/);
  cleanup();

  h.context.retry += 1;
  cleanup = h.effect();
  await settle();
  assert.deepEqual(h.state.stores.map((item) => item.id), ["two"]);
  assert.equal(h.state.error, "");
  assert.ok(h.fetches[2].url.includes("cursor=page-2"), "explicit retry keeps the failed page scope");
  cleanup();
});

test("actual aborted earlier actor read cannot overwrite the newer scoped Store branches", async () => {
  const older = { hold: true, response: { ok: true, json: async () => ({ stores: [store("wrong-actor")], nextCursor: "old-cursor" }) } };
  const newer = { response: { ok: true, json: async () => ({ stores: [store("actor-b-store")], nextCursor: "new-cursor" }) } };
  const h = branchEffectHarness([older, newer]);
  const cleanupOld = h.effect();
  cleanupOld();
  h.context.actorId = "actor-b";
  const cleanupNew = h.effect();
  await settle();
  older.release();
  await settle();
  assert.deepEqual(h.state.stores.map((item) => item.id), ["actor-b-store"]);
  assert.equal(h.state.next, "new-cursor");
  assert.ok(h.fetches[1].url.includes("/roster/actor-b/stores"));
  cleanupNew();
});
