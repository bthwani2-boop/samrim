import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { parseOperatorHomeCity } from "../src/features/workspace/operator-home-city.ts";

const root = resolve(import.meta.dirname, "..");
const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const jsx = (type, props) => ({ type, props: props ?? {} });

function compile(relativePath, dependencies) {
  const compiled = transformSync(readFileSync(resolve(root, relativePath), "utf8"), {
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    }, mod, mod.exports,
  );
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

function marketHarness({ cityFailure = false, storeFailure = false } = {}) {
  const calls = [];
  const render = compile("src/features/workspace/public-market-overview.tsx", {
    "@bthwani/dsh": {
      async listPublicCities(origin, options) {
        calls.push({ kind: "cities", origin, options });
        if (cityFailure) throw new Error("DSH city owner unavailable");
        return { items: ["sanaa"], revision: 4 };
      },
      async listPublicStores(origin, city, options) {
        calls.push({ kind: "stores", origin, city, options });
        if (storeFailure) throw new Error("DSH stores unavailable");
        return { items: [{ id: "store-sanaa", cityId: "sanaa", verticalId: "grocery",
          name: "متجر أ", orderabilityStatus: "OPEN_FOR_ORDERS" }], revision: 5 };
      },
      async listPublicVerticals(origin, city, options) {
        calls.push({ kind: "verticals", origin, city, options });
        return { items: [{ id: "grocery", storeCount: 1 }], revision: 5 };
      },
    },
    "../operator-shell/operator-shell.module.css": { sectionGrid: "grid", sectionCard: "card" },
    "../stores/public-store-query": { resolvePublicDshOrigin: () => "http://127.0.0.1:23202" },
    "./operator-home-city": { parseOperatorHomeCity },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  return { calls, render: (city = {}, canVisitStores = true) => render({
    searchParams: Promise.resolve(city), canVisitStores, canVisitCatalog: false, action: "/merchants",
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
  assert.deepEqual(page.calls.map(call => call.kind).sort(), ["stores", "verticals"]);
  assert.ok(page.calls.every(call => call.origin === "http://127.0.0.1:23202" && call.city === "sanaa"));
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
