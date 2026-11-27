import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { parseOperatorHomeCity } from "../src/features/workspace/operator-home-city.ts";

const root = resolve(import.meta.dirname, "..");
const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const jsx = (type, props) => ({ type, props: props ?? {} });

// Retain uncached fixture modules until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
function compile(path, dependencies) {
  const source = resolve(root, path);
  const compiled = transformSync(readFileSync(source, "utf8"), {
    filename: source, sourceMaps: "inline", inlineSourcesContent: true,
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const mod = loadMappedRenderFixture(compiled, source, dependencies);
  loadedModules.push(mod);
  return mod.exports.default;
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}

function marketingPage(grants) {
  let accessReads = 0;
  const PublicMarketOverview = () => null;
  const WorkspaceUnavailable = () => null;
  const render = compile("app/(workspace)/marketing/page.tsx", {
    "../../../src/features/operator-shell/workspace-unavailable": WorkspaceUnavailable,
    "../../../src/features/workspace/public-market-overview": PublicMarketOverview,
    "../../../src/server/current-operator-access": {
      currentOperatorAccess: async () => {
        accessReads++;
        return grants === null ? null : { grants };
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  return { render, PublicMarketOverview, WorkspaceUnavailable, accessReads: () => accessReads };
}

test("Marketing overview requires a current marketing grant, not a merchant or catalog grant", async () => {
  for (const grants of [null, [], ["merchant"], ["catalog"], ["operations"]]) {
    const page = marketingPage(grants);
    const tree = await page.render({ searchParams: Promise.resolve({ city: "sanaa" }) });
    assert.equal(page.accessReads(), 1);
    assert.equal(tree.type, page.WorkspaceUnavailable);
    assert.equal(find(tree, node => node.type === page.PublicMarketOverview), undefined);
  }
});

test("Marketing grant permits public DSH market read, but not merchant/catalog navigation", async () => {
  const page = marketingPage(["marketing"]);
  const params = Promise.resolve({ city: "sanaa" });
  const tree = await page.render({ searchParams: params });
  assert.equal(page.accessReads(), 1);
  const view = find(tree, node => node.type === page.PublicMarketOverview);
  assert.ok(view);
  assert.equal(view.props.searchParams, params);
  assert.equal(view.props.action, "/marketing");
  assert.equal(view.props.canVisitStores, false);
  assert.equal(view.props.canVisitCatalog, false);
  assert.equal(view.props.canViewPublicMarket, true);
});

test("Marketing market view uses DSH public owner responses and fails closed on errors", async () => {
  const calls = [];
  let unavailable = false;
  const render = compile("src/features/workspace/public-market-overview.tsx", {
    "@bthwani/dsh": {
      async listPublicCities() { return { items: ["sanaa"], revision: 3 }; },
      async listPublicStores(origin, city) {
        calls.push({ origin, city, type: "stores" });
        if (unavailable) throw new Error("owner offline");
        return { items: [{ id: "store-1", name: "متجر منشور", verticalId: "grocery",
          orderabilityStatus: "OPEN_FOR_ORDERS" }], revision: 4 };
      },
      async listPublicVerticals(origin, city) {
        calls.push({ origin, city, type: "verticals" });
        if (unavailable) throw new Error("owner offline");
        return { items: [{ id: "grocery", storeCount: 1 }], revision: 4 };
      },
    },
    "../operator-shell/operator-shell.module.css": { sectionGrid: "grid", sectionCard: "card" },
    "../stores/public-store-query": { resolvePublicDshOrigin: () => "http://127.0.0.1:23202" },
    "./operator-home-city": { parseOperatorHomeCity },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  const input = city => ({ searchParams: Promise.resolve({ city }),
    canVisitStores: false, canVisitCatalog: false, canViewPublicMarket: true, action: "/marketing" });
  const page = await render(input("sanaa"));
  assert.deepEqual(calls.map(c => c.type).sort(), ["stores", "verticals"]);
  assert.ok(calls.every(c => c.origin === "http://127.0.0.1:23202" && c.city === "sanaa"));
  assert.ok(find(page, node => node.type === "strong" && node.props.children === "متجر منشور"));
  assert.equal(find(page, node => node.type === "form").props.action, "/marketing");
  assert.equal(find(page, node => node.type === "a" && /\/(merchants|catalog)/.test(node.props.href ?? "")), undefined);
  unavailable = true;
  const fail = await render(input("sanaa"));
  assert.equal(find(fail, node => node.type === "strong" && node.props.children === "متجر منشور"), undefined);
  assert.ok(find(fail, node => node.props.role === "alert"));
  const before = calls.length;
  const invalid = await render(input("INVALID!"));
  assert.equal(calls.length, before);
  assert.ok(find(invalid, node => node.props.role === "alert"));
});

test("market metrics distinguish complete owner category totals, page coverage and unproven zero", async () => {
  const snapshot = {
    cities: { items: ["sanaa"], revision: 7 },
    stores: { items: [
      { id: "s1", name: "One", verticalId: "grocery", orderabilityStatus: "OPEN_FOR_ORDERS" },
      { id: "s2", name: "Two", verticalId: "grocery", orderabilityStatus: "PAUSED" },
    ], revision: 7, nextCursor: "more" },
    verticals: { items: [{ id: "grocery", storeCount: 8 }, { id: "pharmacy", storeCount: 4 }], revision: 7 },
  };
  const render = compile("src/features/workspace/public-market-overview.tsx", {
    "@bthwani/dsh": {
      async listPublicCities() { return snapshot.cities; },
      async listPublicStores() { return snapshot.stores; },
      async listPublicVerticals() {
        if (!snapshot.verticals) throw new Error("unavailable");
        return snapshot.verticals;
      },
    },
    "../operator-shell/operator-shell.module.css": { sectionGrid: "grid", sectionCard: "card" },
    "../stores/public-store-query": { resolvePublicDshOrigin: () => "http://127.0.0.1:23202" },
    "./operator-home-city": { parseOperatorHomeCity },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  const view = () => render({ searchParams: Promise.resolve({ city: "sanaa" }),
    canVisitStores: false, canVisitCatalog: false, canViewPublicMarket: true, action: "/marketing" });
  const fact = (tree, id) => find(tree, node => node.props["data-testid"] === id);
  const content = node => Array.isArray(node) ? node.map(content).join("") :
    typeof node === "object" && node !== null ? content(node.props?.children) : String(node ?? "");
  let tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "12");
  assert.equal(content(fact(tree, "market-page-open")), "1");
  assert.equal(content(fact(tree, "market-page-paused")), "1");
  assert.match(content(fact(tree, "market-page-scope")), /2/);
  snapshot.verticals.nextCursor = "next";
  tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "غير متاح");
  delete snapshot.verticals.nextCursor;
  snapshot.verticals.items = [{ id: "grocery", storeCount: Number.MAX_SAFE_INTEGER }, { id: "pharmacy", storeCount: 1 }];
  tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "غير متاح");
  snapshot.stores = { items: [], revision: 7 };
  snapshot.verticals = { items: [], revision: 7 };
  tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "0");
  snapshot.cities = { items: [], revision: 7, nextCursor: "later" };
  tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "غير متاح");
  snapshot.cities = { items: ["sanaa"], revision: 6 };
  tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "غير متاح");
  snapshot.verticals = null;
  tree = await view();
  assert.equal(content(fact(tree, "market-published-total")), "غير متاح");
});
