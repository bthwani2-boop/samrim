import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";
import { parseCityPolicy, reconcileCityPolicy } from "./city-policy-command.ts";
import { readRegistrationHistory, readRegistrationOverview } from "./store-registration-command.ts";

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
    assert.equal(url, endpoint + "?history=1&limit=10&beforeVersion=2");
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

test("registration editor requires review of changed terms and preserves an uncertain operation across newer reads and denial", async () => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require("next/dist/build/swc/index.js");
  const source = readFileSync(new URL("./store-registration-policy-editor.tsx", import.meta.url), "utf8");
  const compiled = transformSync(source, {
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const values = [];
  let index = 0;
  let current = { cityId: "sanaa", relation: "MARKETPLACE", version: 1, enabled: true,
    termsVersion: "terms-v1", termsText: "Original", changedByActor: "operator-1",
    changeReason: "Initial", updatedAt: "2026-11-23T00:00:00Z" };
  let result = { status: "unknown" };
  const submitted = [];
  const jsx = (type, props) => ({ type, props });
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: { useState(initial) {
      const i = index++;
      if (!(i in values)) values[i] = initial;
      return [values[i], next => { values[i] = typeof next === "function" ? next(values[i]) : next; }];
    } },
    antd: {
      Alert: "Alert", Button: "Button", Card: "Card", Checkbox: "Checkbox", Space: "Space", Select: "Select",
      Form: { Item: "FormItem" }, Input: { TextArea: "TextArea" }, Radio: { Group: "RadioGroup" },
      Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" },
    },
    "./store-registration-command": {
      readStoreRegistrationPolicy: async () => current,
      matchesPendingPolicy: () => false,
      reconcileRegistrationPolicy: async (_endpoint, _city, _relation, _actor, change) => {
        submitted.push(change);
        return result;
      },
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(mocks, name), name);
    return mocks[name];
  }, module, module.exports);
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
  const citySelect = field("اختيار مدينة قبول المتاجر");
  assert.deepEqual(citySelect.props.options, directory.cities);
  assert.equal(citySelect.props.disabled, false);
  citySelect.props.onChange("sanaa");
  form(0).props.onFinish();
  await settle();
  field("سبب قرار قبول المتاجر").props.onChange({ target: { value: "Review" } });
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
  assert.equal(field("معرّف مدينة قبول المتاجر").props.disabled, true);
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
});

test("policy city directory reads the bounded owner pages without treating partial or failed reads as empty", async () => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require("next/dist/build/swc/index.js");
  const source = readFileSync(new URL("./policy-city-directory.ts", import.meta.url), "utf8");
  const code = transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" } }).code;
  const module = { exports: {} };
  const calls = [];
  let pages = [];
  let origin = "http://127.0.0.1:3202";
  new Function("require", "module", "exports", code)(name => {
    if (name === "@bthwani/dsh") return { listPublicCities: async (url, options) => {
      calls.push({ url, cursor: options.cursor, limit: options.limit });
      const page = pages.shift();
      if (!page) throw new Error("owner unavailable");
      return page;
    } };
    assert.equal(name, "../stores/public-store-query");
    return { resolvePublicDshOrigin: () => origin };
  }, module, module.exports);
  const load = module.exports.loadPolicyCities;
  pages = [{ items: ["aden"], revision: 7, nextCursor: "next" }, { items: ["sanaa"], revision: 7 }];
  assert.deepEqual(await load(), { status: "current", cities: [
    { value: "aden", label: "عدن" }, { value: "sanaa", label: "صنعاء" },
  ] });
  assert.deepEqual(calls.map(call => call.cursor), [undefined, "next"]);
  assert.ok(calls.every(call => call.limit === 50 && call.url === origin));
  pages = [{ items: ["aden"], revision: 7, nextCursor: "next" }, { items: ["sanaa"], revision: 8 }];
  assert.deepEqual(await load(), { status: "unavailable", cities: [] });
  pages = [{ items: ["aden"], revision: 7, nextCursor: "next" }, { items: ["aden"], revision: 7 }];
  assert.deepEqual(await load(), { status: "unavailable", cities: [] });
  pages = [{ items: ["aden"], revision: 7, nextCursor: "next" }];
  assert.deepEqual(await load(), { status: "unavailable", cities: [] });
  pages = [{ items: [], revision: 9 }];
  assert.deepEqual(await load(), { status: "current", cities: [] });
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
  const compiled = transformSync(readFileSync(new URL("./policies-workspace.tsx", import.meta.url), "utf8"), {
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" },
  }).code;
  const states = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  let denied = false;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);
    assert.equal(init.headers["X-BThwani-Operator"], "operator-1");
    return denied ? Response.json({}, { status: 403 }) : Response.json({}, { status: 503 });
  });
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial;
      return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; } },
    antd: { Alert: "Alert", Button: "Button", Card: "Card", Checkbox: "Checkbox",
      Form: { Item: "FormItem" }, Input: { TextArea: "TextArea" }, InputNumber: "Number",
      Select: "Select", Space: "Space", Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" } },
    "next/link": { __esModule: true, default: "Link" },
    "./city-policy-command": { parseCityPolicy, reconcileCityPolicy },
    "./city-policy-history": { __esModule: true, default: "History" },
    "./store-registration-command": { readRegistrationOverview: async (city, actor) => {
      assert.equal(actor, "operator-1");
      calls.push(city);
      return { MARKETPLACE: { status: "current", policy: { version: 2, enabled: true } },
        DIRECT: { status: "unavailable" } };
    } },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(mocks, name), name); return mocks[name];
  }, module, module.exports);
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
  assert.deepEqual(calls, ["/api/policies/cities/sanaa", "sanaa"]);
  city().props.onChange("aden"); assert.equal(overview(), undefined);
  denied = true; read(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(overview(), undefined);
  assert.deepEqual(calls.slice(2), ["/api/policies/cities/aden", "aden"]);
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
