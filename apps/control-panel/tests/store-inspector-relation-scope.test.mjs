import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-inspector.tsx", import.meta.url), "utf8");
const storeWorkspace = readFileSync(new URL("../src/features/stores/store-workspace.tsx", import.meta.url), "utf8");
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

test("Store fulfillment checkbox has its own accessible name", () => {
  assert.match(storeWorkspace, /<input type="checkbox" aria-label=\{option\.label\}/);
  assert.match(storeWorkspace, /<strong>\{option\.label\}<\/strong>/);
});

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

test("switching Store routes never presents the previous Store while the next read is pending", () => {
  assert.match(source, /const currentStore = store\?\.id === storeId \? store : null;/);
  assert.match(source, /const canPublish = Boolean\(currentStore &&/);
  assert.match(source, /StoreProfileDashboard store=\{currentStore\}/);
  assert.match(source, /currentStore\?\.relationModel === "INDEPENDENT_STORE"/);
});

test("late publication completion from an earlier Store cannot repaint the new Store", async () => {
  const begin = source.indexOf("  async function changePublication() {");
  const end = source.indexOf("\n  const publicationAction =", begin);
  assert.ok(begin >= 0 && end > begin, "extract production publication action");
  const transpiled = ts.transpileModule(source.slice(begin, end) + "\nchangePublication;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const store = { id: "store-a", relationModel: "BTHWANI_PARTNER", publicationState: "hidden",
    publicationReadiness: { ready: true }, version: 2 };
  const sequence = { current: 7 };
  const renderedStores = [];
  const notices = [];
  let completeResponse;
  const request = new Promise((resolve) => { completeResponse = resolve; });
  const action = runInNewContext(transpiled, {
    store, currentStore: store, storeId: store.id, busy: false, sequence,
    fetch: () => request,
    partnerMutationHeaders: () => ({}),
    setBusy: () => {}, setError: () => {},
    setNotice: (value) => notices.push(value),
    setStore: (value) => renderedStores.push(value),
    setConfirmHide: () => {}, onUpdated: () => { notices.push("onUpdated"); },
    load: async () => {},
    publicationReadinessBlockedReasonLabel: () => "",
    supportedStoreRelation: (value) => value === "BTHWANI_PARTNER" || value === "INDEPENDENT_STORE",
  });
  const inFlight = action();
  sequence.current += 1; // A newer route/read invalidates this old Store's response.
  completeResponse({ ok: true, json: async () => ({ store }) });
  await inFlight;
  assert.equal(renderedStores.length, 0, "stale Store must never be reinstalled");
  assert.equal(notices.filter(Boolean).length, 0, "stale mutation must not claim new Store success");
});
