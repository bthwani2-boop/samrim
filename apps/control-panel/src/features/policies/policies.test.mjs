import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const loadedModules = [];
process.once("exit", () => loadedModules.length);

import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";
import { parseCityPolicy, reconcileCityPolicy } from "./city-policy-command.ts";
import { clearPendingRegistrationPolicy, readPendingRegistrationPolicy, readRegistrationHistory, readRegistrationOverview, savePendingRegistrationPolicy } from "./store-registration-command.ts";

test("policies: routes have the expected navigation permission boundary", () => {
  for (const path of ["/policies","/policies/stage-sla"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "platform_policies");
  }
});

test("policies: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "platform_policies"), false);
  assert.equal(canShowNavigation(true, [], "platform_policies"), false);
});

const endpoint = "/api/policies/cities/sanaa";
const actorId = "operator-1";
const change = {
  operationId: "city-policy-001",
  expectedVersion: 1,
  maxPauseSeconds: 600,
  maxPreparationMinutes: 20,
  reason: "Scheduled synthetic review",
};
const committed = {
  cityId: "sanaa", version: 2, maxPauseSeconds: 600, maxPreparationMinutes: 20,
  changedByActor: "operator-1", changeReason: change.reason, updatedAt: "2026-11-19T05:00:00Z",
};

test("a lost PATCH reply keeps the command uncertain and reconciles the exact payload after a newer write", async (t) => {
  const superseding = { ...committed, version: 3, maxPauseSeconds: 1200, changedByActor: "operator-2" };
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, endpoint);
    assert.equal(init.headers["X-BThwani-Operator"], actorId);
    if (init.method === "GET") return Response.json(superseding);
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(init.body), change);
    if (fetch.mock.callCount() === 0) throw new TypeError("Network connection lost");
    return Response.json({ replay: true, policy: committed });
  });

  assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
  assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), {
    status: "confirmed", current: superseding, replay: true, superseded: true,
  });
  assert.equal(fetch.mock.callCount(), 3);
});

test("a successful PATCH still requires a matching or newer independent owner readback", async (t) => {
  const stale = { ...committed, version: 1 };
  const result = { replay: false, policy: committed };
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) =>
    Response.json(init.method === "PATCH" ? result : stale));
  assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("a PATCH result for another version, city or command cannot be reported as confirmed", async (t) => {
  for (const conflictingPolicy of [
    { ...committed, version: 3 },
    { ...committed, cityId: "aden" },
    { ...committed, changedByActor: "operator-2" },
    { ...committed, maxPauseSeconds: 601 },
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ replay: true, policy: conflictingPolicy }));
    assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test("policy overview reports independent DSH relation reads and no implicit admission", async t => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push(url);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-BThwani-Operator"], "operator-1");
    if (url.endsWith("/DIRECT")) {
      return Response.json({ cityId: "sanaa", relation: "DIRECT", version: 0, enabled: false });
    }
    return Response.json({
      cityId: "sanaa", relation: "MARKETPLACE", version: 1, enabled: true,
      termsVersion: "terms-market-1", termsText: "Approved registration only",
      changedByActor: "operator-1", changeReason: "Reviewed synthetic policy",
      updatedAt: "2026-11-23T00:00:00Z",
    });
  });
  const overview = await readRegistrationOverview("sanaa", "operator-1");
  assert.deepEqual(seen.sort(), [
    "/api/policies/cities/sanaa/store-registration/DIRECT",
    "/api/policies/cities/sanaa/store-registration/MARKETPLACE",
  ]);
  assert.equal(overview.DIRECT.status, "current");
  assert.equal(overview.DIRECT.policy.version, 0);
  assert.equal(overview.DIRECT.policy.enabled, false);
  assert.equal(overview.MARKETPLACE.status, "current");
  assert.equal(overview.MARKETPLACE.policy.enabled, true);
});

test("policy overview never labels an owner-read failure as closed registration", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async url => url.endsWith("/DIRECT")
    ? Response.json({ cityId: "sanaa", relation: "DIRECT", version: 0, enabled: false })
    : Response.json({ code: "IDENTITY_OWNER_UNAVAILABLE" }, { status: 503 }));
  const overview = await readRegistrationOverview("sanaa", "operator-1");
  assert.deepEqual(overview.MARKETPLACE, { status: "unavailable" });
  assert.equal(overview.DIRECT.status, "current");
  assert.equal(fetch.mock.callCount(), 2);
  await assert.rejects(readRegistrationOverview("../other", "operator-1"), /Invalid DSH city/);
  assert.equal(fetch.mock.callCount(), 2, "invalid city must never reach the BFF");
});

test("Operator policy audit pages bind the request to current city and relation", async t => {
  const entries = [
    { version: 2, enabled: false, termsVersion: "merchant-terms-v1",
      changedByActor: "operator-1", changeReason: "Closed new onboarding",
      updatedAt: "2026-11-23T09:00:00Z" },
    { version: 1, enabled: true, termsVersion: "merchant-terms-v1",
      changedByActor: "operator-1", changeReason: "Opened new onboarding",
      updatedAt: "2026-11-23T07:00:00Z" },
  ];
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/policies/cities/sanaa/store-registration/MARKETPLACE?history=1&limit=10");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-BThwani-Operator"], "operator-1");
    return Response.json({ entries });
  });
  assert.deepEqual(await readRegistrationHistory(
    "/api/policies/cities/sanaa/store-registration/MARKETPLACE",
    "sanaa", "MARKETPLACE", "operator-1",
  ), { entries });
  assert.equal(fetch.mock.callCount(), 1);
});

test("Operator policy audit reader refuses bad cursors, mismatched pages and denied access", async t => {
  const endpoint = "/api/policies/cities/sanaa/store-registration/DIRECT";
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, `${endpoint}?history=1&limit=10&beforeVersion=2`);
    return Response.json({ entries: [{
      version: 2, enabled: true, termsVersion: "merchant-terms-v1",
      changedByActor: "operator-1", changeReason: "Invalid non-descending cursor",
      updatedAt: "2026-11-23T00:00:00Z",
    }] });
  });
  await assert.rejects(readRegistrationHistory(endpoint, "sanaa", "DIRECT", "operator-1", "../2"),
    /Invalid DSH history scope/);
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(readRegistrationHistory(endpoint, "sanaa", "DIRECT", "operator-1", "2"),
    /cursor mismatch/);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(readRegistrationHistory(endpoint, "sanaa", "DIRECT", "operator-1"),
    /Identity rejected/);
});

test("registration editor provisions the first policy only after review and restores the exact command across reload, newer reads and denial", async t => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require("next/dist/build/swc/index.js");
  const source = fileURLToPath(new URL("./store-registration-policy-editor.tsx", import.meta.url));
  const compiled = transformSync(readFileSync(source, "utf8"), {
    filename: source, sourceMaps: "inline", inlineSourcesContent: true,
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const values = [];
  let index = 0;
  let current = { cityId: "sanaa", relation: "MARKETPLACE", version: 0, enabled: false };
  const storage = new Map();
  const browser = { sessionStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  let result = { status: "unknown" };
  let readDenied = false;
  const reads = [];
  const submitted = [];
  const jsx = (type, props) => ({ type, props });
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: { useState(initial) {
      const i = index++;
      if (!(i in values)) values[i] = initial;
      return [values[i], next => { values[i] = typeof next === "function" ? next(values[i]) : next; }];
    }, useRef(initial) {
      const i = index++;
      if (!(i in values)) values[i] = { current: initial };
      return values[i];
    }, useEffect(callback) {
      const i = index++;
      if (!(i in values)) { values[i] = true; callback(); }
    } },
    antd: {
      Alert: "Alert", Button: "Button", Card: "Card", Checkbox: "Checkbox", Space: "Space", Select: "Select",
      Form: { Item: "FormItem" }, Input: { TextArea: "TextArea" }, Radio: { Group: "RadioGroup" },
      Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" },
    },
    "./store-registration-command": {
      readStoreRegistrationPolicy: async (_endpoint, cityId, relation) => {
        reads.push({ cityId, relation });
        if (readDenied) throw new Error("DSH denied");
        return { ...current, cityId, relation };
      },
      clearPendingRegistrationPolicy, readPendingRegistrationPolicy, savePendingRegistrationPolicy,
      reconcileRegistrationPolicy: async (_endpoint, cityId, relation, actorId, change) => {
        assert.deepEqual(readPendingRegistrationPolicy(browser.sessionStorage, actorId), { cityId, relation, change });
        submitted.push(change);
        return result;
      },
    },
  };
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  t.after(() => {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else delete globalThis.window;
  });
  const module = loadMappedRenderFixture(compiled, source, mocks);
  loadedModules.push(module);
  function flatten(tree) {
    return !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
      ? tree.flatMap(flatten) : [tree, ...flatten(tree.props?.children)];
  }
  const directory = { status: "current", cities: [{ value: "sanaa", label: "صنعاء" }] };
  const render = () => { index = 0; return flatten(module.exports.default({ actorId: "operator-1", directory })); };
  const field = label => render().find(n => n.props?.["aria-label"] === label);
  const review = () => render().find(n => n.type === "Checkbox" && String(n.props.children).includes("أؤكد مراجعة"));
  const submit = () => render().find(n => n.type === "Button" && n.props.type === "primary");
  const form = (position) => render().filter(n => n.type === mocks.antd.Form)[position];
  const settle = () => new Promise(resolve => setImmediate(resolve));
  render(); // mount effect restores the browser command before the editor is usable
  const citySelect = field("اختيار مدينة قبول المتاجر");
  assert.deepEqual(citySelect.props.options, directory.cities);
  assert.equal(citySelect.props.disabled, false);
  citySelect.props.onChange("sanaa");
  await settle();
  assert.equal(field("إصدار شروط قبول المتاجر").props.disabled, false, "selecting an active city automatically reads its current policy");
  const relation = () => render().find(n => n.type === "RadioGroup");
  readDenied = true;
  relation().props.onChange({ target: { value: "DIRECT" } });
  await settle();
  assert.equal(field("إصدار شروط قبول المتاجر").props.disabled, true);
  assert.equal(submit().props.disabled, true);
  assert.deepEqual(reads.at(-1), { cityId: "sanaa", relation: "DIRECT" });
  readDenied = false;
  relation().props.onChange({ target: { value: "MARKETPLACE" } });
  await settle();
  assert.equal(field("إصدار شروط قبول المتاجر").props.disabled, false);
  assert.deepEqual(reads.at(-1), { cityId: "sanaa", relation: "MARKETPLACE" });
  const enable = render().find(n => n.type === "Checkbox" && String(n.props.children).includes("السماح بإنشاء متاجر"));
  enable.props.onChange({ target: { checked: true } });
  field("إصدار شروط قبول المتاجر").props.onChange({ target: { value: "terms-v1" } });
  field("نص شروط تسجيل المتجر").props.onChange({ target: { value: "Original" } });
  field("سبب قرار قبول المتاجر").props.onChange({ target: { value: "Review" } });
  assert.equal(submit().props.disabled, true);
  review().props.onChange({ target: { checked: true } });
  assert.equal(submit().props.disabled, false);
  field("نص شروط تسجيل المتجر").props.onChange({ target: { value: "Revised" } });
  assert.equal(review().props.checked, false);
  assert.equal(submit().props.disabled, true);
  review().props.onChange({ target: { checked: true } });
  field("إصدار شروط قبول المتاجر").props.onChange({ target: { value: "terms-v2" } });
  assert.equal(review().props.checked, false);
  review().props.onChange({ target: { checked: true } });
  form(1).props.onFinish();
  await settle();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].expectedVersion, 0);
  assert.equal(field("معرّف مدينة قبول المتاجر").props.disabled, true);
  values.length = 0;
  render(); // reload: new component state, same tab sessionStorage
  assert.equal(field("اختيار مدينة قبول المتاجر").props.value, "sanaa");
  assert.equal(field("نص شروط تسجيل المتجر").props.value, "Revised");
  assert.equal(submit().props.disabled, false);
  assert.equal(field("معرّف مدينة قبول المتاجر").props.disabled, true);
  current = { cityId: "sanaa", relation: "MARKETPLACE", version: 1, enabled: true,
    termsVersion: submitted[0].termsVersion, termsText: submitted[0].termsText,
    changedByActor: "operator-1", changeReason: submitted[0].reason, updatedAt: "2026-11-23T00:00:00Z" };
  form(0).props.onFinish();
  await settle();
  assert.equal(storage.size, 1, "identical policy fields do not prove the command ID");
  current = { ...current, version: 3, changedByActor: "operator-2" };
  form(0).props.onFinish();
  await settle();
  assert.equal(field("معرّف مدينة قبول المتاجر").props.disabled, true, "a newer read does not reconcile the command");
  result = { status: "denied" };
  form(1).props.onFinish();
  await settle();
  assert.equal(submitted.length, 2);
  assert.deepEqual(submitted[1], submitted[0]);
  assert.equal(field("معرّف مدينة قبول المتاجر").props.disabled, true, "denial does not discard the uncertain command");
  assert.equal(field("اختيار مدينة قبول المتاجر").props.disabled, true);
  result = { status: "confirmed", current, replay: true, superseded: true };
  form(1).props.onFinish();
  await settle();
  assert.equal(submitted.length, 3);
  assert.deepEqual(submitted[2], submitted[0]);
  assert.equal(storage.size, 0);
  assert.equal(field("اختيار مدينة قبول المتاجر").props.disabled, false);
});

test("policy city directory reads the bounded owner pages without treating partial or failed reads as empty", async () => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require("next/dist/build/swc/index.js");
  const source = fileURLToPath(new URL("./policy-city-directory.ts", import.meta.url));
  const code = transformSync(readFileSync(source, "utf8"), { filename: source, sourceMaps: "inline", inlineSourcesContent: true, jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" } }).code;
  const calls = [];
  let pages = [];
  let origin = "http://127.0.0.1:3202";
  let lateController;
  const module = loadMappedRenderFixture(code, source, {
    "@bthwani/dsh": { listPublicCities: async (url, options) => {
      calls.push({ url, cursor: options.cursor, limit: options.limit });
      const page = pages.shift();
      if (!page) throw new Error("owner unavailable");
      lateController?.abort();
      return page;
    } },
    "../stores/public-store-query": { resolvePublicDshOrigin: () => origin },
  });
  loadedModules.push(module);
  const load = module.exports.loadPolicyCities;
  const ids = ["aden", ...Array.from({ length: 49 }, (_, i) => "city-" + String(i).padStart(2, "0"))];
  const first = { items: ids, revision: 7, nextCursor: "next" };
  pages = [first, { items: ["sanaa"], revision: 7 }];
  assert.deepEqual(await load(), { status: "current", cities: [
    { value: "aden", label: "عدن" },
    ...ids.slice(1).map(value => ({ value, label: value })),
    { value: "sanaa", label: "صنعاء" },
  ] });
  assert.deepEqual(calls.map(call => call.cursor), [undefined, "next"]);
  assert.ok(calls.every(call => call.limit === 50 && call.url === origin));
  for (const invalidPages of [
    [first, { items: ["sanaa"], revision: 8 }],
    [first, { items: ["aden"], revision: 7 }],
    [first],
    [{ items: ["aden"], revision: 7, nextCursor: "next" }, { items: ["sanaa"], revision: 7 }],
    [first, { items: [], revision: 7 }],
    [first, { items: ids.map(value => "other-" + value), revision: 7, nextCursor: "next" }],
    Array.from({ length: 10 }, (_, i) => ({
      items: Array.from({ length: 50 }, (_, j) => "city-" + (i * 50 + j)),
      revision: 7, nextCursor: "page-" + i,
    })),
  ]) {
    pages = [...invalidPages];
    assert.deepEqual(await load(), { status: "unavailable", cities: [] });
  }
  pages = [{ items: [], revision: 9 }];
  assert.deepEqual(await load(), { status: "current", cities: [] });
  const deadline = new AbortController();
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = () => deadline.signal;
    lateController = deadline;
    pages = [{ items: ["sanaa"], revision: 9 }];
    assert.deepEqual(await load(), { status: "unavailable", cities: [] });
  } finally {
    AbortSignal.timeout = originalTimeout;
    lateController = undefined;
  }
  const before = calls.length;
  origin = null;
  assert.deepEqual(await load(), { status: "unavailable", cities: [] });
  assert.equal(calls.length, before);
});

test("operational policy refuses malformed owner evidence", () => {
  assert.deepEqual(parseCityPolicy(committed, "sanaa"), committed);
  for (const invalid of [
    { ...committed, maxPauseSeconds: -1 },
    { ...committed, maxPreparationMinutes: 1441 },
    { ...committed, updatedAt: "not a timestamp" },
    { ...committed, changedByActor: " " },
    { ...committed, changeReason: "" },
    { ...committed, extra: "unknown" },
  ]) assert.equal(parseCityPolicy(invalid, "sanaa"), null);
});

test("operational policy never confirms a different audit identity or reason at the same version", async t => {
  for (const [write, read] of [
    [{ ...committed, changeReason: "Different command" }, committed],
    [committed, { ...committed, changedByActor: "operator-2" }],
    [committed, { ...committed, changeReason: "Different command" }],
    [committed, { ...committed, updatedAt: "2026-11-19T06:00:00Z" }],
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async (_url, init) =>
      Response.json(init.method === "PATCH" ? { policy: write, replay: false } : read));
    assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
    fetch.mock.restore();
  }
});

test("policy center renders independently verified city admission, clears old scope, and hides evidence after denial", async t => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require("next/dist/build/swc/index.js");
  const source = fileURLToPath(new URL("./policies-workspace.tsx", import.meta.url));
  const compiled = transformSync(readFileSync(source, "utf8"), {
    filename: source, sourceMaps: "inline", inlineSourcesContent: true,
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" },
  }).code;
  const states = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  let denied = false;
  let currentPolicy = null;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);
    assert.equal(init.headers["X-BThwani-Operator"], "operator-1");
    if (denied) return Response.json({}, { status: 403 });
    if (url.endsWith("?delivery=1")) return Response.json({
      cityId: "sanaa", version: 3, radiusMetres: 18000, updatedAt: "2026-11-24T05:00:00Z",
    });
    return currentPolicy ? Response.json(currentPolicy) : Response.json({}, { status: 503 });
  });
  const mocks = {
    "@bthwani/dsh": require("@bthwani/dsh"),
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial;
      return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; } },
    antd: { Alert: "Alert", Button: "Button", Card: "Card", Checkbox: "Checkbox",
      Form: { Item: "FormItem" }, Input: { TextArea: "TextArea" }, InputNumber: "Number",
      Select: "Select", Space: "Space", Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" } },
    "next/link": { __esModule: true, default: "Link" },
    "./city-policy-command": { parseCityPolicy, reconcileCityPolicy },
    "./city-policy-history": { __esModule: true, default: "History" },
    "./delivery-policy-preview": { __esModule: true, default: "DeliveryPolicyPreview" },
    "./store-registration-command": { readRegistrationOverview: async (city, actor) => {
      assert.equal(actor, "operator-1");
      calls.push(city);
      return { MARKETPLACE: { status: "current", policy: { version: 2, enabled: true } },
        DIRECT: { status: "unavailable" } };
    } },
  };
  const module = loadMappedRenderFixture(compiled, source, mocks);
  loadedModules.push(module);
  function flatten(tree) { return !tree || typeof tree !== "object" ? [] :
    Array.isArray(tree) ? tree.flatMap(flatten) : [tree, ...flatten(tree.props?.children)]; }
  const render = () => { index = 0; return flatten(module.exports.default({ actorId: "operator-1",
    directory: { status: "current", cities: [{ value: "sanaa", label: "Sanaa" }, { value: "aden", label: "Aden" }] } })); };
  const city = () => render().find(n => n.props?.["aria-label"] === "اختيار المدينة");
  const overview = () => render().find(n => n.props?.["aria-label"] === "قبول المتاجر حسب النموذج");
  const read = () => render().find(n => n.type === mocks.antd.Form).props.onFinish();
  city().props.onChange("sanaa"); read(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(overview());
  assert.match(JSON.stringify(overview()), /القبول متاح — الإصدار 2/);
  assert.match(JSON.stringify(overview()), /تعذر التحقق من المالك/);
  const radius = () => render().find(n => n.props?.["aria-label"] === "نطاق التوصيل الحالي");
  assert.ok(radius());
  assert.match(JSON.stringify(radius()), /18000/);
  assert.deepEqual(calls, ["/api/policies/cities/sanaa", "sanaa", "/api/policies/cities/sanaa?delivery=1"]);
  city().props.onChange("aden"); assert.equal(overview(), undefined);
  assert.equal(radius(), undefined);
  read(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(radius());
  assert.doesNotMatch(JSON.stringify(radius()), /18000/);
  denied = true; read(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(overview(), undefined);
  assert.equal(radius(), undefined);
  assert.deepEqual(calls.slice(3), ["/api/policies/cities/aden", "aden", "/api/policies/cities/aden?delivery=1",
    "/api/policies/cities/aden", "aden", "/api/policies/cities/aden?delivery=1"]);

  const history = () => render().find(n => n.type === "History");
  assert.equal(history()?.props.onDraft, undefined, "denial cannot offer reuse");
  denied = false;
  city().props.onChange("sanaa");
  currentPolicy = {...committed, version: 4};
  read(); await new Promise(resolve => setImmediate(resolve));
  const field = label => render().find(n => n.props?.["aria-label"] === label);
  const submit = () => render().find(n => n.type === "Button" && n.props.type === "primary");
  const historical = {...committed, version: 2, maxPauseSeconds: 120, maxPreparationMinutes: 10};
  field("سبب تغيير السياسة").props.onChange({target: {value: "Previous draft reason"}});
  const before = calls.length;
  history().props.onDraft({...historical, cityId: "aden"});
  history().props.onDraft({...historical, version: 4});
  assert.equal(field("حد الإيقاف بالثواني").props.value, currentPolicy.maxPauseSeconds);
  history().props.onDraft(historical);
  assert.equal(field("حد الإيقاف بالثواني").props.value, 120);
  assert.equal(field("حد التحضير بالدقائق").props.value, 10);
  assert.equal(field("سبب تغيير السياسة").props.value, "");
  assert.equal(submit().props.disabled, true);
  assert.equal(calls.length, before, "draft must not issue a network mutation");
  field("سبب تغيير السياسة").props.onChange({target: {value: "Reviewed historical values"}});
  assert.equal(submit().props.disabled, false);
});

test("operational policy refuses mismatched endpoint before network access", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected traffic"); });
  for (const [path, city, actor] of [
    ["/api/policies/cities/aden", "sanaa", actorId],
    ["https://example.invalid", "sanaa", actorId],
    [endpoint, "../sanaa", actorId],
    [endpoint, "sanaa", ""],
  ]) assert.deepEqual(await reconcileCityPolicy(path, city, actor, change), { status: "rejected" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("policy directory composes the actual DSH city SDK and recovers after an invalid page", async t => {
  const { loadPolicyCities } = await import("./policy-city-directory.ts");
  const previous = process.env.OPERATOR_POLICY_DSH_ORIGIN;
  process.env.OPERATOR_POLICY_DSH_ORIGIN = "http://127.0.0.1:3202";
  let replies = [{ items: ["sanaa"], revision: 10 }];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin + target.pathname, "http://127.0.0.1:3202/v1/public/cities");
    assert.equal(target.searchParams.get("limit"), "50");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    requests.push(target.searchParams.get("cursor"));
    const body = replies.shift();
    if (!body) throw new Error("owner disconnected");
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  });
  try {
    assert.deepEqual(await loadPolicyCities(), { status: "current", cities: [{ value: "sanaa", label: "صنعاء" }] });
    replies = [{ items: ["aden", "aden"], revision: 10 }];
    assert.deepEqual(await loadPolicyCities(), { status: "unavailable", cities: [] });
    const full = index => Array.from({ length: 50 }, (_, j) => "city-" + (index * 50 + j));
    const first = { items: full(0), revision: 10, nextCursor: "next" };
    for (const invalid of [
      [first, { items: ["sanaa"], revision: 11 }],
      [first, { items: [full(0)[0]], revision: 10 }],
      [first, { items: [], revision: 10 }],
      [{ items: ["aden"], revision: 10, nextCursor: "next" }],
      [first, { items: full(1), revision: 10, nextCursor: "other" },
        { items: full(2), revision: 10, nextCursor: "next" }],
      Array.from({ length: 10 }, (_, i) => ({ items: full(i), revision: 10, nextCursor: "page-" + i })),
      [first],
    ]) {
      replies = [...invalid];
      assert.deepEqual(await loadPolicyCities(), { status: "unavailable", cities: [] });
    }
    replies = [first, { items: ["aden", "taiz"], revision: 10 }];
    const recovered = await loadPolicyCities();
    assert.equal(recovered.status, "current");
    assert.deepEqual(recovered.cities.slice(-2), [{ value: "aden", label: "عدن" }, { value: "taiz", label: "taiz" }]);
    assert.deepEqual(requests.slice(-2), [null, "next"]);
    process.env.OPERATOR_POLICY_DSH_ORIGIN = "invalid";
    const before = requests.length;
    assert.deepEqual(await loadPolicyCities(), { status: "unavailable", cities: [] });
    assert.equal(requests.length, before);
  } finally {
    if (previous === undefined) delete process.env.OPERATOR_POLICY_DSH_ORIGIN;
    else process.env.OPERATOR_POLICY_DSH_ORIGIN = previous;
  }
});
