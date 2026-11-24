import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePublishedOfferQuery, publishedOfferHref } from "../src/features/catalog/published-offer-query.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const source = readFileSync(fileURLToPath(
  new URL("../src/features/catalog/published-offers.tsx", import.meta.url),
), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const productsRoute = transformSync(readFileSync(new URL("../app/(workspace)/catalog/products/page.tsx", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const jsx = (type, props) => ({ type, props: props ?? {} });
const store = { id: "market-sanaa", name: "متجر صنعاء", cityId: "sanaa",
  verticalId: "grocery", orderabilityStatus: "PAUSED", orderingAvailable: false };
const publishedOffer = { id: "offer-one", storeId: store.id, name: "منتج متاح",
  variantId: "variant-one", priceYer: "9007199254740993", available: true };

function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}

function harness({ permitted = true, origin = "http://127.0.0.1:3202", failStore = false,
  failOffers = false, empty = false } = {}) {
  const calls = [];
  const modules = {
    "@bthwani/dsh": {
      async getPublicStore(base, id) {
        calls.push({ kind: "store", base, id });
        if (failStore) throw new Error("store unavailable");
        return store;
      },
      async listPublicOffers(base, id, options) {
        calls.push({ kind: "offers", base, id, options });
        if (failOffers) throw new Error("owner unavailable");
        return { items: empty ? [] : [publishedOffer], revision: 11,
          ...(empty ? {} : { nextCursor: "nextcursor" }) };
      },
    },
    "../operator-shell/operator-shell.module.css": { workspace: "workspace", sectionGrid: "sectionGrid", sectionCard: "sectionCard" },
    "./published-offers.module.css": { intro: "intro", eyebrow: "eyebrow", filters: "filters", results: "results", table: "table" },
    "../operator-shell/workspace-unavailable": () => null,
    "../stores/public-store-query": { resolvePublicDshOrigin: () => origin },
    "../workspace/public-market-overview": { __esModule: true, default: "MarketOverview" },
    "../../server/current-operator-access": {
      currentOperatorAccess: async () => permitted ? { grants: ["catalog"] } : { grants: ["merchant"] },
    },
    "./published-offer-query": { parsePublishedOfferQuery, publishedOfferHref },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
      return modules[name];
    }, mod, mod.exports,
  );
  const products = { exports: {} };
  new Function("require", "module", "exports", productsRoute)(name => {
    if (name === "react/jsx-runtime") return modules[name];
    assert.equal(name, "../../../../src/features/catalog/published-offers");
    return { __esModule: true, default: mod.exports.default };
  }, products, products.exports);
  return {
    calls,
    render: (params = { store: "market-sanaa" }) =>
      mod.exports.default({ searchParams: Promise.resolve(params) }),
    async renderProducts(params) {
      const route = products.exports.default({ searchParams: Promise.resolve(params) });
      return route.type(route.props);
    },
  };
}

test("catalog public query rejects arrays, extra keys, invalid store IDs, controls and replay cursors", () => {
  assert.deepEqual(parsePublishedOfferQuery({}), { storeId: "", query: "" });
  assert.equal(parsePublishedOfferQuery({ store: ["a", "b"] }), null);
  assert.equal(parsePublishedOfferQuery({ store: "MIXED" }), null);
  assert.equal(parsePublishedOfferQuery({ store: "market-sanaa", owner: "http://attacker" }), null);
  assert.equal(parsePublishedOfferQuery({ store: "market-sanaa", q: "x\u0000" }), null);
  assert.equal(parsePublishedOfferQuery({ store: "market-sanaa", cursor: "." }), null);
  assert.deepEqual(parsePublishedOfferQuery({ store: "market-sanaa", q: " منتج " }),
    { storeId: "market-sanaa", query: "منتج" });
  assert.equal(publishedOfferHref({ storeId: "market-sanaa", query: "منتج", cursor: "opaque" }),
    "/catalog?store=market-sanaa&q=%D9%85%D9%86%D8%AA%D8%AC&cursor=opaque");
});

test("catalog denies non-catalog operators before any owner request", async () => {
  const view = harness({ permitted: false });
  await view.render();
  assert.equal(view.calls.length, 0);
});

test("catalog requires an explicit validated Store and a loopback owner", async () => {
  const none = harness();
  const initial = await none.render({});
  assert.equal(none.calls.length, 0);
  assert.ok(find(initial, node => node.props?.role === "status"));
  const missingOwner = harness({ origin: null });
  const missingView = await missingOwner.render();
  assert.equal(missingOwner.calls.length, 0);
  assert.ok(find(missingView, node => node.props?.role === "alert"));
  const bad = harness();
  const invalid = await bad.render({ store: "market-sanaa", injected: "wrong" });
  assert.equal(bad.calls.length, 0);
  assert.ok(find(invalid, node => node.props?.role === "alert"));
});

test("catalog displays only owner-confirmed Store Offers and revision with safe page cursor", async () => {
  const view = harness();
  const result = await view.render({ store: "market-sanaa", q: "منتج", cursor: "previous" });
  assert.deepEqual(view.calls.map(call => call.kind), ["store", "offers"]);
  assert.equal(view.calls[0].id, store.id);
  assert.equal(view.calls[1].options.limit, 20);
  assert.equal(view.calls[1].options.query, "منتج");
  assert.equal(view.calls[1].options.cursor, "previous");
  assert.ok(find(result, node => node.type === "strong" && node.props.children === publishedOffer.name));
  assert.ok(find(result, node => node.type === "code" &&
    String(node.props.children).includes("9007199254740993")));
  const next = find(result, node => node.type === "a" && node.props.href?.includes("cursor=nextcursor"));
  assert.ok(next);
  assert.match(next.props.href, /q=%D9%85%D9%86%D8%AA%D8%AC/);
  assert.equal(find(result, node => node.props?.role === "alert"), undefined);
});

test("catalog never invents Offers after an owner failure or empty result", async () => {
  for (const options of [{ failStore: true }, { failOffers: true }]) {
    const view = harness(options);
    const tree = await view.render();
    assert.ok(find(tree, node => node.props?.role === "alert"));
    assert.equal(find(tree, node => node.type === "strong" && node.props.children === publishedOffer.name), undefined);
  }
  const empty = harness({ empty: true });
  const tree = await empty.render();
  assert.ok(find(tree, node => node.props?.children === "لا توجد عروض منشورة مطابقة للبحث."));
  assert.equal(find(tree, node => node.type === "strong" && node.props.children === publishedOffer.name), undefined);
});

test("catalog renders an accessible DSH-backed results table without inventing global totals", async () => {
  const view = harness();
  const tree = await view.render();
  const table = find(tree, node => node.type === "table" && node.props["aria-label"] === "العروض المنشورة");
  assert.ok(table, "published Offers use a comparison table, not a grid of unrelated cards");
  const heading = find(table, node => node.type === "th" && node.props.children === "السعر المنشور");
  assert.ok(heading);
  assert.equal(find(tree, node => node.props?.children === "4,892"), undefined);
});

test("catalog offers a permitted Store discovery route when no Store ID is known", async () => {
  const view = harness();
  const tree = await view.render({});
  assert.equal(view.calls.length, 0);
  const link = find(tree, node => node.type === "a" && node.props.href === "/workspace");
  assert.ok(link, "catalog should link to the existing Identity-gated DSH market directory");
  assert.match(link.props.children, /المتجر/);
});

test("the Products tab opens the catalog-authorized Store directory and keeps product searches on its own route", async () => {
  const view = harness();
  const initial = await view.renderProducts({ city: "sanaa" });
  const directory = find(initial, node => node.type === "MarketOverview");
  assert.equal(directory.props.action, "/catalog/products");
  assert.equal(directory.props.canVisitCatalog, true);
  assert.deepEqual(await directory.props.searchParams, { city: "sanaa" });
  assert.equal(view.calls.length, 0);

  const products = await view.renderProducts({ store: store.id, q: "منتج", cursor: "old" });
  assert.ok(find(products, node => node.type === "form" && node.props.action === "/catalog/products"));
  assert.ok(find(products, node => node.type === "strong" && node.props.children === publishedOffer.name));
  assert.ok(find(products, node => node.props.href === "/catalog/products?store=market-sanaa&q=%D9%85%D9%86%D8%AA%D8%AC&cursor=nextcursor"));

  const denied = harness({ permitted: false });
  const forbidden = await denied.renderProducts({ city: "sanaa" });
  assert.equal(find(forbidden, node => node.type === "MarketOverview"), undefined);
  assert.equal(denied.calls.length, 0);
});
