import assert from "node:assert/strict";
import { test } from "node:test";
import { readCityPolicyHistory } from "./city-policy-command.ts";

const endpoint = "/api/policies/cities/sanaa";
const page = { cityId: "sanaa", entries: [{ cityId: "sanaa", version: 4, maxPauseSeconds: 120,
  maxPreparationMinutes: 30, changedByActor: "operator-a", changeReason: "Reviewed limits",
  updatedAt: "2026-11-23T12:00:00Z" }] };

test("Operator audit browser request binds city, actor and cursor to the existing BFF", async t => {
  const spy = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, endpoint + "?history=1&limit=10&beforeVersion=5");
    assert.equal(init.method, "GET");
    assert.equal(init.headers["X-BThwani-Operator"], "operator-a");
    assert.equal(init.cache, "no-store");
    return Response.json(page);
  });
  assert.deepEqual(await readCityPolicyHistory(endpoint, "sanaa", "operator-a", "5"), page);
  await assert.rejects(readCityPolicyHistory("/api/policies/cities/aden", "sanaa", "operator-a"));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a", "0"));
  assert.equal(spy.mock.callCount(), 1);
});
test("Operator audit browser rejects cross-city, denied and abandoned responses", async t => {
  const spy = t.mock.method(globalThis, "fetch", async () => Response.json({ ...page, cityId: "aden" }));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a"));
  spy.mock.mockImplementation(async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a"));
  const controller = new AbortController();
  controller.abort();
  spy.mock.mockImplementation(async () => Response.json(page));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a", undefined, controller.signal));
});

test("historical limits compare against verified current policy and only prepare a draft", async t => {
  const {readFileSync} = await import("node:fs");
  const {createRequire} = await import("node:module");
  const require = createRequire(import.meta.url);
  const {transformSync} = require("next/dist/build/swc/index.js");
  const code = transformSync(readFileSync(new URL("./city-policy-history.tsx", import.meta.url), "utf8"), {
    jsc: {parser: {syntax: "typescript", tsx: true}, target: "es2022", transform: {react: {runtime: "automatic"}}},
    module: {type: "commonjs"},
  }).code;
  const states = [];
  let index = 0;
  const jsx = (type, props) => ({type, props});
  const drafts = [];
  const current = {...page.entries[0], version: 5, maxPauseSeconds: 600, maxPreparationMinutes: 45};
  const mocks = {
    "react/jsx-runtime": {jsx, jsxs: jsx, Fragment: "Fragment"},
    react: {
      useState(initial) {const i = index++; if (!(i in states)) states[i] = initial;
        return [states[i], next => {states[i] = next;}];},
      useRef(initial) {const i = index++; if (!(i in states)) states[i] = {current: initial}; return states[i];},
      useEffect() {},
    },
    antd: {Alert: "Alert", Button: "Button", Card: "Card", Space: "Space", Typography: {Paragraph: "Paragraph"}},
    "./city-policy-command": {readCityPolicyHistory},
  };
  const module = {exports: {}};
  new Function("require", "module", "exports", code)(name => mocks[name], module, module.exports);
  function flatten(tree) {return !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
    ? tree.flatMap(flatten) : [tree, ...flatten(tree.props?.children)];}
  const render = (overrides = {}) => {index = 0; return flatten(module.exports.default({
    actorId: "operator-a", city: "sanaa", endpoint, current, onDraft: entry => drafts.push(entry), ...overrides,
  }));};
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.method, "GET"); return Response.json(page);
  });
  render().find(n => n.type === "Button").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const compare = () => render().find(n => n.props?.["aria-label"] === "مقارنة الإصدار التاريخي بالحالي");
  assert.ok(compare());
  assert.match(JSON.stringify(compare()), /600/);
  assert.match(JSON.stringify(compare()), /120/);
  const draft = nodes => nodes.find(n => n.type === "Button" && n.props.children === "استخدام القيم كمسودة");
  draft(render()).props.onClick();
  assert.deepEqual(drafts, [page.entries[0]]);
  assert.equal(fetch.mock.callCount(), 1);
  for (const overrides of [{current: null}, {current: {...current, cityId: "aden"}}, {current: {...current, version: 4}}, {onDraft: undefined}]) {
    assert.equal(draft(render(overrides)), undefined);
  }

  const newest = { ...page, entries: Array.from({ length: 10 }, (_, i) => ({ ...page.entries[0], version: 14 - i })), nextBeforeVersion: "5" };
  const cursors = [];
  let failed = false;
  fetch.mock.mockImplementation(async (url, init) => {
    assert.equal(init.method, "GET");
    const before = new URL(url, "http://localhost").searchParams.get("beforeVersion");
    cursors.push(before);
    if (before && !failed) {
      failed = true;
      return Response.json({ code: "OWNER_UNAVAILABLE" }, { status: 503 });
    }
    return Response.json(before ? page : newest);
  });
  const click = label => {
    const nodes = render();
    const button = [...nodes, ...nodes.flatMap(node => flatten(node.props?.action))]
      .find(node => node.type === "Button" && node.props.children === label);
    assert.ok(button, `missing action: ${label}`);
    button.props.onClick();
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  click("قراءة سجل الإصدارات");
  await settle();
  click("الإصدارات الأقدم");
  await settle();
  assert.ok(render().some(node => node.type === "Alert"));
  assert.ok(!render().some(node => node.type === "li"));
  assert.equal(draft(render()), undefined);
  click("إعادة قراءة الصفحة");
  await settle();
  assert.ok(draft(render()));
  click("الإصدارات الأحدث");
  await settle();
  assert.deepEqual(cursors, [null, "5", "5", null]);
});
