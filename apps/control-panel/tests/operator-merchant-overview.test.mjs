import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { parsePublicStoreBrowse } from "../src/features/stores/public-store-query.ts";
import { parseOperatorHomeCity } from "../src/features/workspace/operator-home-city.ts";

const root = resolve(import.meta.dirname, "..");
const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const jsx = (type, props) => ({ type, props: props ?? {} });

// Retain uncached fixture modules until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
function compile(relativePath, dependencies) {
  const source = resolve(root, relativePath);
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
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}

function merchantRoute(grants) {
  const calls = [];
  const StoresWorkspace = () => null;
  const PublicMarketOverview = () => null;
  const WorkspaceUnavailable = () => null;
  const render = compile("app/(workspace)/merchants/page.tsx", {
    "../../../src/features/stores/stores-workspace": StoresWorkspace,
    "../../../src/features/workspace/public-market-overview": PublicMarketOverview,
    "../../../src/features/operator-shell/workspace-unavailable": WorkspaceUnavailable,
    "../../../src/server/current-operator-access": {
      currentOperatorAccess: async () => {
        calls.push("identity");
        return grants === null ? null : { grants };
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  return { calls, render, StoresWorkspace, PublicMarketOverview, WorkspaceUnavailable };
}

test("Merchant workspace fails closed without a current Identity merchant grant", async () => {
  for (const grants of [null, [], ["catalog"], ["operations"]]) {
    const page = merchantRoute(grants);
    const tree = await page.render({ searchParams: Promise.resolve({ city: "sanaa" }) });
    assert.deepEqual(page.calls, ["identity"]);
    assert.equal(tree.type, page.WorkspaceUnavailable);
    assert.equal(find(tree, node => node.type === page.PublicMarketOverview), undefined);
  }
});

test("authorized Merchant workspace includes real DSH overview with no finance or catalog grant", async () => {
  const page = merchantRoute(["merchant"]);
  const searchParams = Promise.resolve({ city: "sanaa" });
  const tree = await page.render({ searchParams });
  assert.deepEqual(page.calls, ["identity"]);
  assert.equal(tree.type, page.StoresWorkspace);
  const overview = tree.props.marketOverview;
  assert.equal(overview.type, page.PublicMarketOverview);
  assert.equal(overview.props.action, "/merchants");
  assert.equal(overview.props.searchParams, searchParams);
  assert.equal(overview.props.canVisitStores, true);
  assert.equal(overview.props.canVisitCatalog, false);
});

function marketHarness({ cityFailure = false, storeFailure = false, nextCursor, action = "/merchants" } = {}) {
  const calls = [];
  const render = compile("src/features/workspace/public-market-overview.tsx", {
    "@bthwani/dsh": {
      async listPublicCities(origin, options) {
        calls.push({ kind: "cities", origin, options });
        if (cityFailure) throw new Error("DSH city owner unavailable");
        return { items: ["sanaa", "aden"], revision: 4 };
      },
      async listPublicStores(origin, city, options) {
        calls.push({ kind: "stores", origin, city, options });
        if (storeFailure) throw new Error("DSH stores unavailable");
        return { items: [{ id: "store-sanaa", cityId: "sanaa", verticalId: "grocery",
          name: "متجر أ", orderabilityStatus: "OPEN_FOR_ORDERS" }], revision: 5, nextCursor };
      },
      async listPublicVerticals(origin, city, options) {
        calls.push({ kind: "verticals", origin, city, options });
        return { items: [{ id: "grocery", storeCount: 1 }], revision: 5 };
      },
    },
    "../operator-shell/operator-shell.module.css": { sectionGrid: "grid", sectionCard: "card" },
    "../stores/public-store-query": { parsePublicStoreBrowse, resolvePublicDshOrigin: () => "http://127.0.0.1:23202" },
    "./operator-home-city": { parseOperatorHomeCity },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  return { calls, render: (city = {}, canVisitStores = true, canVisitCatalog = false) => render({
    searchParams: Promise.resolve(city), canVisitStores, canVisitCatalog, action,
  }) };
}

test("Merchant city picker stays within Merchant route and reads cities from DSH", async () => {
  const page = marketHarness();
  const tree = await page.render({});
  assert.deepEqual(page.calls.map(call => call.kind), ["cities"]);
  assert.equal(page.calls[0].origin, "http://127.0.0.1:23202");
  assert.equal(find(tree, node => node.type === "form").props.action, "/merchants");
  assert.equal(find(tree, node => node.type === "option").props.value, "sanaa");
});

test("Merchant overview shows DSH-confirmed Stores, without fabricating totals or extra grants", async () => {
  const page = marketHarness();
  const tree = await page.render({ city: "sanaa" });
  assert.deepEqual(page.calls.map(call => call.kind).sort(), ["cities", "stores", "verticals"]);
  assert.ok(page.calls.every(call => call.origin === "http://127.0.0.1:23202" && (call.kind === "cities" || call.city === "sanaa")));
  assert.ok(find(tree, node => node.type === "strong" && node.props.children === "متجر أ"));
  assert.equal(find(tree, node => node.type === "form").props.action, "/merchants");
  assert.equal(find(tree, node => node.type === "a" &&
    String(node.props.href).includes("/catalog/")), undefined);
});

test("DSH outage and malformed city never create fictional published Store results", async () => {
  const failing = marketHarness({ storeFailure: true });
  const failTree = await failing.render({ city: "sanaa" });
  assert.ok(find(failTree, node => node.props.role === "alert"));
  assert.equal(find(failTree, node => node.type === "strong" &&
    node.props.children === "متجر أ"), undefined);
  const malformed = marketHarness();
  const invalid = await malformed.render({ city: "sanaa", owner: "http://attacker" });
  assert.equal(malformed.calls.length, 0);
  assert.ok(find(invalid, node => node.props.role === "alert"));
  const denied = marketHarness();
  assert.equal(await denied.render({ city: "sanaa" }, false), null);
  assert.equal(denied.calls.length, 0);
});

test("Catalog-granted Operator can open DSH-confirmed Store offers without typing a Store ID", async () => {
  const permitted = marketHarness();
  const tree = await permitted.render({ city: "sanaa" }, true, true);
  const link = find(tree, node => node.type === "a" && node.props.href === "/catalog?store=store-sanaa");
  assert.ok(link, "store card should link to the exact DSH-confirmed public Store");
  assert.match(link.props.children, /العروض/);
  const merchantOnly = marketHarness();
  const noCatalog = await merchantOnly.render({ city: "sanaa" });
  assert.equal(find(noCatalog, node => node.type === "a" && node.props.href?.startsWith("/catalog?")), undefined);
});

test("the Products Store picker sends bounded owner search and retains pagination on the Products tab", async () => {
  const page = marketHarness({ action: "/catalog/products", nextCursor: "next" });
  const tree = await page.render({ city: "sanaa", storeQ: " market ", storeCursor: "previous" }, false, true);
  assert.deepEqual(page.calls.map(call => call.kind), ["cities", "stores"]);
  assert.equal(page.calls[1].options.query, "market");
  assert.equal(page.calls[1].options.cursor, "previous");
  assert.equal(page.calls[1].options.limit, 20);
  assert.ok(find(tree, node => node.props.href === "/catalog/products?store=store-sanaa"));
  assert.ok(find(tree, node => node.props.href === "/catalog/products?city=sanaa&storeQ=market&storeCursor=next"));
  assert.ok(find(tree, node => node.props.href === "/catalog/products?city=sanaa&storeQ=market"));
  const malformed = marketHarness({ action: "/catalog/products" });
  const invalid = await malformed.render({ city: "sanaa", storeCursor: ["a", "b"] }, false, true);
  assert.ok(find(invalid, node => node.props.role === "alert"));
  assert.equal(malformed.calls.length, 0);
});

test("failed Products Store continuation exposes a first-page recovery link preserving city and search", async () => {
  const page = marketHarness({ action: "/catalog/products", storeFailure: true });
  const tree = await page.render({ city: "sanaa", storeQ: "market", storeCursor: "stale" }, false, true);
  assert.ok(find(tree, node => node.props.role === "alert"));
  assert.ok(find(tree, node => node.type === "a" && node.props.href === "/catalog/products?city=sanaa&storeQ=market"));
  assert.equal(find(tree, node => node.type === "strong"), undefined);
});

test("selected city keeps owner city choices on every market surface", async () => {
  for (const action of ["/workspace", "/merchants", "/marketing", "/catalog/products"]) {
    const page = marketHarness({ action });
    const tree = await page.render({ city: "sanaa" }, true, true);
    assert.ok(find(tree, node => node.type === "option" && node.props.value === "aden"), action);
    assert.equal(find(tree, node => node.type === "input" && node.props.name === "city").props.defaultValue, "sanaa");
    assert.equal(find(tree, node => node.type === "form").props.action, action);
  }
});

test("city directory outage does not hide confirmed selected-city market data", async () => {
  const page = marketHarness({ cityFailure: true });
  const tree = await page.render({ city: "sanaa" });
  assert.ok(find(tree, node => node.props.role === "alert" && /المدن/.test(node.props.children)));
  assert.ok(find(tree, node => node.type === "strong" && node.props.children === "متجر أ"));
  assert.ok(find(tree, node => node.type === "strong" && node.props.children === "grocery"));
  assert.equal(find(tree, node => node.type === "input" && node.props.name === "city").props.defaultValue, "sanaa");
});

test("Merchant overview exposes actual DSH preparation review, not fake creation actions", () => {
  const render = compile("src/features/stores/stores-workspace.tsx", {
    "../operator-shell/operator-shell.module.css": { sectionGrid: "grid", sectionCard: "card" },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  const tree = render({});
  const review = find(tree, node => node.type === "a" && node.props.href === "/merchants/joining");
  assert.ok(review, "actual review must be discoverable from the Merchant overview");
  assert.match(JSON.stringify(review.props.children), /مراجعة المتاجر غير المنشورة/);
  assert.equal(find(tree, node => node.type === "a" && node.props.href === "/merchants/new"), undefined);
  assert.ok(find(tree, node => node.type === "a" && node.props.href === "/merchants/public-stores"));
});