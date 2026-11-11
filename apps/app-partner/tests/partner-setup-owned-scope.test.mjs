import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const file = new URL("../app/setup.tsx", import.meta.url);
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load" &&
      node.initializer && ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(ast) === "useCallback") {
    loader = node.initializer.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(loader, "run actual Partner first-Store scope loader");

const compiled = ts.transpileModule("(" + loader.getText(ast) + ")", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness(pages, additional = false, switchOnRead = false) {
  const events = { reads: 0, redirects: [], draftsCleared: 0, options: 0, errors: [], ready: [] };
  let liveScope = "merchant-session";
  const api = {
    listPartnerAccessibleStores: async () => {
      const result = pages[events.reads++] ?? { stores: [], nextCursor: "" };
      if (switchOnRead) liveScope = "different-session";
      return result;
    },
    listActiveServiceCities: async () => { events.options++; return [{ id: "city", displayNameAr: "صنعاء" }]; },
    listCatalogVerticals: async () => { events.options++; return [{ id: "vertical", active: true }]; },
    listStoreJoiningPolicies: async () => { events.options++; return { items: [] }; },
  };
  const env = {
    additional, scope: "merchant-session", draftScope: "merchant-session",
    router: { replace: (route) => events.redirects.push(route) },
    setChecking: () => {}, setRegistryReady: (ready) => events.ready.push(ready),
    setError: (error) => events.errors.push(error),
    setCities: () => {}, setVerticals: () => {}, setJoiningPolicies: () => {},
    setCity: () => {}, setVertical: () => {}, setRelation: () => {},
    currentIdentityState: () => liveScope, partnerSetupSessionKey: x => x,
    getUsableIdentityAccessToken: async () => "token",
    clearPartnerSetupDraft: () => events.draftsCleared++,
    service: () => api, firstStoreRelationCanEnroll: () => true,
    errorText: (error) => String(error?.message ?? error),
  };
  return { load: runInNewContext(compiled, env), events };
}

test("delegated Store does not block creation of first owned Store", async () => {
  const { load, events } = harness([{ stores: [{ id: "delegated", owned: false }], nextCursor: "" }]);
  await load();
  assert.deepEqual(events.redirects, []);
  assert.equal(events.options, 3);
  assert.equal(events.ready.at(-1), true);
});

test("owned Store on later page prevents a second first-Store", async () => {
  const { load, events } = harness([
    { stores: [{ id: "delegated", owned: false }], nextCursor: "page-two" },
    { stores: [{ id: "owned", owned: true }], nextCursor: "" },
  ]);
  await load();
  assert.deepEqual(events.redirects, ["/more"]);
  assert.equal(events.options, 0);
  assert.equal(events.draftsCleared, 1);
});

test("cursor cycle fails closed before displaying potentially incomplete ownership", async () => {
  const { load, events } = harness([
    { stores: [{ id: "delegated", owned: false }], nextCursor: "same" },
    { stores: [{ id: "delegated", owned: false }], nextCursor: "same" },
  ]);
  await load();
  assert.equal(events.options, 0);
  assert.ok(events.errors.some(x => x.includes("STORE_SCOPES_INCOMPLETE")));
  assert.notEqual(events.ready.at(-1), true);
});

test("identity switch during the read never loads a former owner's options", async () => {
  const { load, events } = harness([{ stores: [], nextCursor: "" }], false, true);
  await load();
  assert.equal(events.options, 0);
  assert.deepEqual(events.redirects, []);
});

test("direct additional-Store URL cannot bypass the first-Store owner flow", async () => {
  const { load, events } = harness([{ stores: [{ id: "delegated", owned: false }], nextCursor: "" }], true);
  await load();
  assert.deepEqual(events.redirects, ["/setup"]);
  assert.equal(events.options, 0);
});

test("additional-Store setup accepts a proven owned Store without redirect", async () => {
  const { load, events } = harness([{ stores: [{ id: "owner-store", owned: true }], nextCursor: "" }], true);
  await load();
  assert.deepEqual(events.redirects, []);
  assert.equal(events.options, 3);
  assert.equal(events.ready.at(-1), true);
});
