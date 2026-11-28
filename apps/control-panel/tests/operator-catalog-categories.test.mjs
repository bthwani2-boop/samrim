import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { parsePublicStoreBrowse } from "../src/features/stores/public-store-query.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
// Retain uncached modules until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const source = fileURLToPath(new URL("../app/(workspace)/catalog/categories/page.tsx", import.meta.url));
const compiled = transformSync(readFileSync(source, "utf8"), {
  filename: source, sourceMaps: "inline", inlineSourcesContent: true,
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

const jsx = (type, props) => ({ type, props: props ?? {} });
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function harness({ permitted = true, failCity = false, failVertical = false,
  origin = "http://127.0.0.1:3202", empty = false } = {}) {
  const calls = [];
  const imports = {
    "@bthwani/dsh": {
      async listPublicCities(owner, options) {
        calls.push({ kind: "cities", owner, options });
        if (failCity) throw new Error("cities unavailable");
        return { items: ["aden", "sanaa"], revision: 4 };
      },
      async listPublicVerticals(owner, city, options) {
        calls.push({ kind: "verticals", owner, city, options });
        if (failVertical) throw new Error("verticals unavailable");
        return { items: empty ? [] : [{ id: "grocery", storeCount: 2 }],
          revision: 4, ...(empty ? {} : { nextCursor: "nextcursor" }) };
      },
    },
    "../../../../src/features/operator-shell/operator-shell.module.css": {
      workspace: "workspace", sectionGrid: "sectionGrid", sectionCard: "sectionCard",
    },
    "../../../../src/features/operator-shell/workspace-unavailable": () => null,
    "../../../../src/features/stores/public-store-query": {
      parsePublicStoreBrowse, isolatedPublicDshOrigin: () => origin,
    },
    "../../../../src/server/current-operator-access": {
      currentOperatorAccess: async () => permitted ? { grants: ["catalog"] } : { grants: ["merchant"] },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = loadMappedRenderFixture(compiled, source, imports);
  loadedModules.push(mod);
  return {
    calls,
    render: (params = { city: "sanaa" }) =>
      mod.exports.default({ searchParams: Promise.resolve(params) }),
  };
}

test("unauthorized Operator never reads DSH catalog taxonomy or city directory", async () => {
  const h = harness({ permitted: false });
  await h.render({ city: "sanaa" });
  assert.deepEqual(h.calls, []);
});

test("invalid category query and owner origin fail before any DSH read", async () => {
  for (const params of [
    { city: ["sanaa"] }, { city: "Sanaa" }, { city: "sanaa", q: "private" },
    { cursor: "validcursor" }, { city: "sanaa", cursor: "." },
  ]) {
    const h = harness();
    const view = await h.render(params);
    assert.equal(h.calls.length, 0);
    assert.ok(find(view, node => node.props?.role === "alert"));
  }
  const noOwner = harness({ origin: null });
  const view = await noOwner.render({ city: "sanaa" });
  assert.equal(noOwner.calls.length, 0);
  assert.ok(find(view, node => node.props?.role === "alert"));
});

test("authorized category page reads DSH cities and city-scoped verticals with pagination", async () => {
  const h = harness();
  const view = await h.render({ city: "sanaa", cursor: "previouscursor" });
  assert.deepEqual(h.calls.map(c => c.kind), ["cities", "verticals"]);
  assert.ok(h.calls.every(c => c.owner === "http://127.0.0.1:3202"));
  assert.equal(h.calls[1].city, "sanaa");
  assert.equal(h.calls[1].options.cursor, "previouscursor");
  assert.equal(h.calls[1].options.limit, 20);
  assert.ok(find(view, node => node.type === "strong" && node.props.children === "grocery"));
  assert.ok(find(view, node => node.type === "option" && node.props.value === "sanaa"));
  assert.ok(find(view, node => node.type === "a" && node.props.href?.includes("cursor=nextcursor")));
  assert.ok(find(view, node => node.type === "a" && node.props.href === "/catalog/categories?city=sanaa"));
});

test("no city selected reads only DSH city directory without inventing a taxonomy", async () => {
  const h = harness();
  const view = await h.render({});
  assert.deepEqual(h.calls.map(c => c.kind), ["cities"]);
  assert.ok(find(view, node => node.type === "option" && node.props.value === "aden"));
  assert.equal(find(view, node => node.type === "strong" && node.props.children === "grocery"), undefined);
});

test("independent city outage preserves valid taxonomy, vertical outage fails closed", async () => {
  const city = harness({ failCity: true });
  const cityView = await city.render();
  assert.ok(find(cityView, node => node.type === "strong" && node.props.children === "grocery"));
  assert.ok(find(cityView, node => node.props?.role === "status"));
  const vertical = harness({ failVertical: true });
  const verticalView = await vertical.render();
  assert.ok(find(verticalView, node => node.props?.role === "alert"));
  assert.equal(find(verticalView, node => node.type === "strong" && node.props.children === "grocery"), undefined);
  const empty = harness({ empty: true });
  const emptyView = await empty.render();
  assert.ok(find(emptyView, node => node.props?.role === "status"));
});

test("failed vertical continuation offers a first-page recovery link for the same city", async () => {
  const h = harness({ failVertical: true });
  const view = await h.render({ city: "sanaa", cursor: "previouscursor" });
  assert.ok(find(view, node => node.props?.role === "alert"));
  assert.ok(find(view, node => node.type === "a" && node.props.href === "/catalog/categories?city=sanaa"));
  assert.equal(find(view, node => node.type === "strong"), undefined);
  const firstPage = await h.render({ city: "sanaa" });
  assert.equal(find(firstPage, node => node.type === "a" && node.props.href === "/catalog/categories?city=sanaa"), undefined);
});
