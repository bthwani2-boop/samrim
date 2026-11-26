import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const loadedModules = [];
process.once("exit", () => loadedModules.length);

import { parsePublicStoreBrowse, parsePublicStoreDetail, publicStoreDetailHref, publicStorePageHref, resolvePublicDshOrigin } from "./public-store-query.ts";

test("store detail links preserve the scoped city and encoded search without an arbitrary destination", () => {
  const detail = parsePublicStoreDetail("market-sanaa", { city: "sanaa", q: " مخبز ", cursor: "Ab_20" });
  assert.deepEqual(detail, { storeId: "market-sanaa", city: "sanaa", query: "مخبز", cursor: "Ab_20" });
  assert.equal(publicStoreDetailHref("market-sanaa", { city: "sanaa", query: "مخبز" }),
    "/merchants/public-stores/market-sanaa?city=sanaa&q=%D9%85%D8%AE%D8%A8%D8%B2");
});

test("Store detail and its return route retain the Operator vertical filter", () => {
  const scope = parsePublicStoreDetail("market-sanaa", { city: "sanaa", vertical: "grocery", q: "market" });
  assert.equal(scope?.vertical, "grocery");
  assert.equal(publicStoreDetailHref("market-sanaa", scope),
    "/merchants/public-stores/market-sanaa?city=sanaa&q=market&vertical=grocery");
});

test("a malformed Store ID, city or continuation never reaches the owner", () => {
  const bad = ["../merchants", "%2f", "store?role=admin", "", "A".repeat(65)];
  for (const id of bad) assert.equal(parsePublicStoreDetail(id, { city: "sanaa" }), null, id);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: "" }), null);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: ["sanaa", "aden"] }), null);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: "sanaa", cursor: "?" }), null);
});

test("offer search stays separate from Store directory filters across pagination", () => {
  const scope = parsePublicStoreDetail("market-sanaa", {
    city: "sanaa", vertical: "grocery", q: "مخبز", offerQ: " دقيق_% ", cursor: "Ab_20",
  });
  assert.deepEqual(scope, { storeId: "market-sanaa", city: "sanaa", vertical: "grocery", query: "مخبز",
    offerQuery: "دقيق_%", cursor: "Ab_20" });
  const next = new URL(publicStoreDetailHref(scope.storeId, scope), "http://localhost");
  assert.equal(next.searchParams.get("offerQ"), "دقيق_%");
  assert.equal(next.searchParams.get("cursor"), "Ab_20");
  const back = new URL(publicStorePageHref({ city: scope.city, query: scope.query, vertical: scope.vertical }), "http://localhost");
  assert.equal(back.searchParams.get("q"), "مخبز");
  assert.equal(back.searchParams.has("offerQ"), false);
  assert.equal(parsePublicStoreBrowse({ city: "sanaa", offerQ: "دقيق" }), null);
});

test("malformed, repeated and overlong offer search is rejected before an owner request", () => {
  for (const offerQ of [["a", "b"], "\u0000bad", "😀".repeat(81), "\uD800"]) {
    assert.equal(parsePublicStoreDetail("market-sanaa", { city: "sanaa", offerQ }), null);
  }
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: "sanaa", offerQ: "😀".repeat(80) })?.offerQuery.length, 160);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: "sanaa", offerQ: " " })?.offerQuery, undefined);
});

test("Operator detail sends the Offer filter to DSH and keeps it in the next page", async t => {
  const previous = process.env.OPERATOR_POLICY_DSH_ORIGIN;
  process.env.OPERATOR_POLICY_DSH_ORIGIN = "http://127.0.0.1:3202";
  t.after(() => {
    if (previous === undefined) delete process.env.OPERATOR_POLICY_DSH_ORIGIN;
    else process.env.OPERATOR_POLICY_DSH_ORIGIN = previous;
  });
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const page = path.join(root, "apps/control-panel/app/(workspace)/merchants/public-stores/[storeId]/page.tsx");
  const temp = mkdtempSync(path.join(tmpdir(), "bth-operator-offers-"));
  try {
    const compile = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), page,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp], { cwd: root, encoding: "utf8", timeout: 20000 });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const jsx = (type, props) => ({type, props});
    const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
      node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
    const calls = [];
    let grants = ["merchant"];
    const mod = loadMappedRenderFixture(readFileSync(path.join(temp, "page.js"), "utf8"), page, {
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "../../../../../src/features/operator-shell/operator-shell.module.css": { __esModule: true, default: {} },
      "../../../../../src/features/operator-shell/workspace-unavailable": { __esModule: true, default: "Unavailable" },
      "../../../../../src/server/current-operator-access": { currentOperatorAccess: async () => ({ grants }) },
      "../../../../../src/features/stores/public-store-query": { parsePublicStoreDetail, publicStoreDetailHref, publicStorePageHref, resolvePublicDshOrigin },
      "@bthwani/dsh": {
        getPublicStore: async (_origin, id) => ({ id, name: "مخبز", cityId: "sanaa", verticalId: "grocery", orderabilityStatus: "OPEN_FOR_ORDERS" }),
        listPublicOffers: async (_origin, id, options) => { calls.push([id, options.query, options.cursor]);
          return { items: [], revision: 3, nextCursor: "next_page" }; },
      },
    });
    loadedModules.push(mod);
    const render = (searchParams) => mod.exports.default({
      params: Promise.resolve({ storeId: "market-sanaa" }), searchParams: Promise.resolve(searchParams),
    });
    const tree = nodes(await render({ city: "sanaa", vertical: "grocery", q: "مخبز", offerQ: "دقيق", cursor: "current_page" }));
    assert.deepEqual(calls, [["market-sanaa", "دقيق", "current_page"]]);
    const next = tree.find(node => node.type === "a" && node.props.children === "عرض المزيد من العروض");
    const nextQuery = new URL(next.props.href, "http://localhost").searchParams;
    assert.equal(nextQuery.get("offerQ"), "دقيق");
    assert.equal(nextQuery.get("cursor"), "next_page");
    const form = tree.find(node => node.type === "form");
    assert.ok(!nodes(form).some(node => node.props?.name === "cursor"), "new search must start from page one");
    grants = ["operations"];
    assert.equal((await render({ city: "sanaa", offerQ: "دقيق" })).type, "Unavailable");
    assert.equal(calls.length, 1);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
