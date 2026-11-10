import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

function loadRoute(name, imports) {
  const source = readFileSync(new URL(`../app/api/partners/${name}/route.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(code, {
    exports, URL, Request, Response, Buffer,
    require(path) {
      if (path === "node:crypto") return { createHash };
      if (path === "next/server") return { NextResponse: Response };
      const dependency = Object.entries(imports).find(([suffix]) => path.endsWith(suffix));
      assert.ok(dependency, `unexpected route dependency ${path}`);
      return dependency[1];
    },
  });
  return exports;
}

const store = (id, relationModel) => ({
  id, relationModel, partnerActorId: "owner", name: id, version: 1,
  fulfillmentModes: [], publicationState: "unpublished",
});
const market = store("market", "BTHWANI_PARTNER");
const independent = store("direct", "INDEPENDENT_STORE");

function setup() {
  const calls = [];
  let identity = { subject: "operator-a", sessionId: "session-a", role: "operator", permissions: ["partners"] };
  let answer = null;
  const imports = {
    "identity-bff": { readOperatorSession: async () => identity, readManagedIdentityRolesBatch: async () => [] },
    "operator-workspace-access": { operatorWorkspacePermissionDenied: (actor, permission) => actor.permissions.includes(permission) ? null : new Response(null, { status: 403 }) },
    "csrf": { verifySameOrigin: () => true },
    "dsh-bff": { listOperatorStores: async (...args) => {
      calls.push(args);
      const relation = args[8];
      return answer ?? { stores: [market, independent].filter((item) => !relation || item.relationModel === relation), nextCursor: "next-owner-page" };
    } },
  };
  const registry = loadRoute("registry", imports);
  const workbench = loadRoute("workbench", { ...imports, "../registry/route": registry });
  const get = (filters) => workbench.GET(new Request("http://localhost/api/partners/workbench?" + new URLSearchParams({ kind: "store", ...filters })));
  return { get, calls, changeSession: (sessionId) => { identity = { ...identity, sessionId }; },
    deny: () => { identity = { ...identity, permissions: [] }; }, respond: (page) => { answer = page; } };
}

test("one workbench queries DSH for all Stores or either relation before paging", async () => {
  const { get, calls } = setup();
  for (const [relationModel, ids] of [["", ["market", "direct"]], ["BTHWANI_PARTNER", ["market"]], ["INDEPENDENT_STORE", ["direct"]]]) {
    const response = await get({ relationModel, q: "test store", serviceCityId: "city-1", sort: "oldest" });
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.deepEqual(page.rows.map((row) => row.store.id), ids);
    assert.ok(page.nextCursor);
    assert.deepEqual(calls.at(-1).slice(0, 7), ["", "test store", "city-1", "contains", "updated_asc", 10, ""]);
    assert.equal(calls.at(-1)[8], relationModel);
  }
});

test("registry rejects cross-relation and prior-session cursors before querying DSH", async () => {
  const { get, calls, changeSession } = setup();
  const relationModel = "INDEPENDENT_STORE";
  const { nextCursor: cursor } = await (await get({ relationModel })).json();
  assert.equal((await get({ relationModel, cursor })).status, 200);
  assert.equal(calls.at(-1)[6], "next-owner-page");
  assert.equal((await get({ relationModel: "BTHWANI_PARTNER", cursor })).status, 400);
  changeSession("session-b");
  assert.equal((await get({ relationModel, cursor })).status, 400);
  assert.equal(calls.length, 2);
});

test("invalid filters and an operator without Partners permission cannot read registry records", async () => {
  const { get, calls, deny } = setup();
  assert.equal((await get({ relationModel: "UNKNOWN" })).status, 400);
  assert.equal((await get({ kind: "partner", relationModel: "INDEPENDENT_STORE" })).status, 400);
  assert.equal((await get({ q: "+967700000001" })).status, 400);
  deny();
  assert.equal((await get({ relationModel: "INDEPENDENT_STORE" })).status, 403);
  assert.equal(calls.length, 0);
});

test("invalid or mismatched DSH readback never appears as Store rows", async () => {
  const { get, respond } = setup();
  for (const page of [
    { stores: [market] },
    { stores: [null] },
    { stores: [{ ...independent, id: "" }] },
    { stores: [{ ...independent, name: "" }] },
    { stores: [{ ...independent, partnerActorId: "" }] },
    { stores: [{ ...independent, version: 0 }] },
    { stores: [{ ...independent, publicationState: "published" }] },
    { stores: [independent, independent] },
    { stores: [independent], nextCursor: 47 },
    { stores: [independent], nextCursor: "x".repeat(1025) },
    { stores: Array.from({ length: 11 }, (_, i) => store(String(i), "INDEPENDENT_STORE")) },
  ]) {
    respond(page);
    const response = await get({ relationModel: "INDEPENDENT_STORE" });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).rows, undefined);
  }
});

test("session unmount aborts the workbench request and discards a late decoded response", async () => {
  const source = readFileSync(new URL("../src/features/partner-onboarding/partners-workbench.tsx", import.meta.url), "utf8");
  const boundary = readFileSync(new URL("../src/features/partner-onboarding/partner-workspace.tsx", import.meta.url), "utf8");
  assert.match(boundary, /<Fragment key=\{JSON\.stringify\(\[state\.identity\.subject, state\.identity\.sessionId\]\)\}/);
  assert.match(source, /useCursorPage\("cursor", filterKey, true, undefined, sessionKey\)/);
  const declarations = source.match(/  const load = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[page\.ready, load, revision\]\);/)?.[0];
  assert.ok(declarations, "exercise the mounted workbench request and cleanup");
  const code = ts.transpile(declarations, { target: ts.ScriptTarget.ES2022 });
  let cleanup;
  let signal;
  let deliver;
  const readbacks = [];
  const decoded = new Promise((resolve) => { deliver = resolve; });
  runInNewContext(code, {
    useCallback: (callback) => callback,
    useEffect: (callback) => { cleanup = callback(); },
    page: { ready: true }, revision: 0, sequence: { current: 0 }, activeRead: { current: null },
    kind: "store", status: "", city: "", sort: "newest", relationModel: "INDEPENDENT_STORE",
    appliedSearch: "", cursor: "", readScope: "scope", isPhone: () => false,
    AbortSignal, AbortController, URLSearchParams,
    fetch: async (url, options) => {
      assert.equal(new URL(url, "http://localhost").searchParams.get("relationModel"), "INDEPENDENT_STORE");
      signal = options.signal;
      return { ok: true, status: 200, json: () => decoded };
    },
    setLoading() {}, setError() {}, setSelected() {}, setReadback: (value) => readbacks.push(value),
  });
  await new Promise((resolve) => setImmediate(resolve));
  cleanup();
  assert.equal(signal.aborted, true);
  deliver({ rows: [{ kind: "store", store: independent }], nextCursor: "" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(readbacks, []);
});
