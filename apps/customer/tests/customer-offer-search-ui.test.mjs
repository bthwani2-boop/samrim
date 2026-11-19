import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as serviceability from "../src/features/location/serviceability.ts";
import * as loader from "../src/features/stores/store-detail-loader.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../src/features/stores/store-detail-screen.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-offer-search-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), entry,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "store-detail-screen.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function harness({ params = {}, id = "store-a" } = {}) {
  const hooks = [], requests = [], effects = new Map(), deps = new Map(), cleanups = new Map();
  let index = 0;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const read = (kind, storeId, options) => new Promise((resolve, reject) => requests.push({ kind, storeId, ...options, resolve, reject }));
  const modules = {
    "@bthwani/dsh": {
      getPublicStore: (_origin, storeId, signal) => read("store", storeId, { signal }),
      listPublicOffers: (_origin, storeId, options) => read("offers", storeId, options),
    },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "expo-router": { Link: "Link", useLocalSearchParams: () => params },
    react: {
      useState(initial) { const at = index++; if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }]; },
      useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
      useEffect(effect, next) { const at = index++; const old = deps.get(at);
        if (!old || next.some((value, i) => value !== old[i])) { deps.set(at, next); effects.set(at, effect); } },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": Object.fromEntries(["ActivityIndicator", "Pressable", "SafeAreaView", "ScrollView", "Text", "TextInput", "View"].map(type => [type, type])),
    "../catalog/store-products": { __esModule: true, default: "StoreProducts" },
    "../location/serviceability": serviceability,
    "../sharing/store-share": { publicStorefrontPath: storeId => `/s/${storeId}` },
    "./orderability": { describeStoreOrderability: () => ({}) },
    "./public-store-origin": { resolvePublicStoreOrigin: () => "" },
    "./store-detail-loader": loader,
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`); return modules[name];
  }, mod, mod.exports);
  return {
    render() { index = 0; const view = mod.exports.default({ storeID: id });
      for (const [at, effect] of effects) { cleanups.get(at)?.(); cleanups.set(at, effect()); }
      effects.clear(); return view; },
    store(next) { id = next; },
    read(kind = "offers") { const at = requests.findIndex(request => request.kind === kind);
      assert.notEqual(at, -1, `expected ${kind} request`); return requests.splice(at, 1)[0]; },
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const byId = (view, id) => find(view, node => node.props?.testID === id);
const button = (view, label) => find(view, node => node.type === "Pressable" && node.props?.accessibilityLabel === label);
const products = view => find(view, node => node.type === "StoreProducts")?.props.offers ?? [];
const settle = () => new Promise(resolve => setImmediate(resolve));
const store = id => ({ id, name: `اسم ${id}`, cityId: "sanaa", verticalId: "grocery", orderingAvailable: false, orderabilityStatus: "OPERATIONALLY_UNAVAILABLE" });
const offer = (id, storeId = "store-a") => ({ id, storeId, name: id, variantId: `v-${id}`, priceYer: 100, available: true });
async function open(app, { items = [offer("first")], nextCursor } = {}) {
  app.render(); app.read("store").resolve(store("store-a"));
  const request = app.read(); request.resolve({ items, nextCursor, revision: 1 }); await settle(); return request;
}
function submit(app, value) {
  byId(app.render(), "offers-search").props.onChangeText(value);
  byId(app.render(), "offers-search").props.onSubmitEditing();
  return app.render();
}

test("Store browse q stays a return-link context and does not filter the Store's Offers", async () => {
  const app = harness({ params: { city: "sanaa", q: "متجر" } });
  const initial = await open(app);
  assert.equal(initial.query, "");
  const view = app.render();
  assert.equal(byId(view, "offers-search").props.value, "");
  assert.deepEqual(find(view, node => node.type === "Link" && node.props.href?.pathname === "/stores").props.href.params,
    { city: "sanaa", q: "متجر" });
});

test("Offer search submits actual text, pages with that query and retries the same failed continuation", async () => {
  const app = harness(); await open(app);
  submit(app, "  دقيق  ");
  app.read("store").resolve(store("store-a"));
  const first = app.read(); assert.equal(first.query, "دقيق"); assert.equal(first.cursor, undefined);
  first.resolve({ items: [offer("match-a")], nextCursor: "next-page", revision: 1 }); await settle();
  let operation = button(app.render(), "عرض المزيد من عروض المتجر").props.onPress();
  let next = app.read(); assert.equal(next.query, "دقيق"); assert.equal(next.cursor, "next-page");
  next.reject(new Error("OWNER_NETWORK_UNAVAILABLE")); await operation;
  assert.deepEqual(products(app.render()).map(item => item.id), ["match-a"]);
  operation = button(app.render(), "إعادة تحميل عروض المتجر").props.onPress();
  next = app.read(); assert.equal(next.query, "دقيق"); assert.equal(next.cursor, "next-page");
  next.resolve({ items: [offer("match-b")], revision: 1 }); await operation;
  assert.deepEqual(products(app.render()).map(item => item.id), ["match-a", "match-b"]);
});

test("changing search resets pagination, hides old Offers and rejects a late previous-page response", async () => {
  const app = harness(); await open(app, { nextCursor: "old-page" });
  const oldMore = button(app.render(), "عرض المزيد من عروض المتجر").props.onPress();
  const late = app.read();
  assert.deepEqual(products(submit(app, "ماء")), []);
  assert.equal(late.signal.aborted, true);
  app.read("store").resolve(store("store-a"));
  const current = app.read(); assert.equal(current.cursor, undefined); assert.equal(current.query, "ماء");
  current.resolve({ items: [offer("water")], revision: 2 }); await settle();
  late.resolve({ items: [offer("late-flour")], revision: 1 }); await oldMore;
  assert.deepEqual(products(app.render()).map(item => item.id), ["water"]);
  button(app.render(), "مسح البحث في عروض المتجر").props.onPress(); app.render();
  assert.deepEqual(products(app.render()), []);
  app.read("store").resolve(store("store-a"));
  const cleared = app.read(); assert.equal(cleared.query, ""); assert.equal(cleared.cursor, undefined);
  cleared.resolve({ items: [], revision: 2 }); await settle();
  assert.equal(byId(app.render(), "offers-search").props.value, "");
  assert.ok(byId(app.render(), "offers-empty"));
});

test("switching Store resets local Offer search and ignores the previous Store's late request", async () => {
  const app = harness(); await open(app); submit(app, "دقيق");
  const oldStore = app.read("store"), oldOffers = app.read();
  app.store("store-b"); assert.deepEqual(products(app.render()), []);
  app.render();
  assert.equal(oldOffers.signal.aborted, true);
  const newStore = app.read("store"), newOffers = app.read();
  assert.equal(newOffers.storeId, "store-b"); assert.equal(newOffers.query, ""); assert.equal(newOffers.cursor, undefined);
  newStore.resolve(store("store-b")); newOffers.resolve({ items: [offer("b", "store-b")], revision: 1 }); await settle();
  oldStore.resolve(store("store-a")); oldOffers.resolve({ items: [offer("late-a")], revision: 1 }); await settle();
  assert.deepEqual(products(app.render()).map(item => item.storeId), ["store-b"]);
  assert.equal(byId(app.render(), "offers-search").props.value, "");
});

test("search controls remain mounted while pending and clear starts an unfiltered first page", async () => {
  const app = harness(); await open(app); submit(app, "دقيق");
  const pendingStore = app.read("store"), pendingOffers = app.read();
  const searching = app.render();
  assert.equal(byId(searching, "offers-search").props.value, "دقيق");
  assert.ok(button(searching, "تنفيذ البحث في عروض المتجر"));
  button(searching, "مسح البحث في عروض المتجر").props.onPress(); app.render();
  assert.equal(byId(app.render(), "offers-search").props.value, "");
  assert.ok(pendingOffers.signal.aborted);
  app.read("store").resolve(store("store-a"));
  const unfiltered = app.read(); assert.equal(unfiltered.query, ""); assert.equal(unfiltered.cursor, undefined);
  unfiltered.resolve({ items: [offer("all")], revision: 2 }); await settle();
  pendingStore.resolve(store("store-a")); pendingOffers.resolve({ items: [offer("obsolete")], revision: 1 }); await settle();
  assert.deepEqual(products(app.render()).map(item => item.id), ["all"]);
});

test("a new submitted query can replace a pending search without waiting for its response", async () => {
  const app = harness(); await open(app); submit(app, "دقيق");
  const firstStore = app.read("store"), firstOffers = app.read();
  byId(app.render(), "offers-search").props.onChangeText("ماء");
  button(app.render(), "تنفيذ البحث في عروض المتجر").props.onPress(); app.render();
  assert.ok(firstOffers.signal.aborted);
  app.read("store").resolve(store("store-a"));
  const second = app.read(); assert.equal(second.query, "ماء"); assert.equal(second.cursor, undefined);
  second.resolve({ items: [offer("water")], revision: 2 }); await settle();
  firstStore.resolve(store("store-a")); firstOffers.resolve({ items: [offer("flour")], revision: 1 }); await settle();
  assert.deepEqual(products(app.render()).map(item => item.id), ["water"]);
});

for (const code of ["STALE_CURSOR", "INVALID_CURSOR"]) {
  test(`${code} discards old Offer prices and retries the active search at page one`, async () => {
    const app = harness(); await open(app); submit(app, "دقيق");
    app.read("store").resolve(store("store-a")); app.read().resolve({ items: [offer("a")], nextCursor: "stale", revision: 1 }); await settle();
    const more = button(app.render(), "عرض المزيد من عروض المتجر").props.onPress(); app.read().reject(new Error(code)); await more;
    assert.deepEqual(products(app.render()), []);
    button(app.render(), "إعادة تحميل عروض المتجر").props.onPress(); app.render();
    app.read("store").resolve(store("store-a"));
    const retry = app.read(); assert.equal(retry.query, "دقيق"); assert.equal(retry.cursor, undefined);
    retry.resolve({ items: [], revision: 2 }); await settle();
    assert.match(byId(app.render(), "offers-empty").props.children, /مطابقة/);
  });
}

test("publication denial during searched pagination conceals the entire Store projection", async () => {
  const app = harness(); await open(app); submit(app, "دقيق");
  app.read("store").resolve(store("store-a")); app.read().resolve({ items: [offer("a")], nextCursor: "next", revision: 1 }); await settle();
  const more = button(app.render(), "عرض المزيد من عروض المتجر").props.onPress(); app.read().reject(new Error("NOT_FOUND")); await more;
  assert.equal(byId(app.render(), "store-title"), undefined);
  assert.equal(byId(app.render(), "offers-search"), undefined);
  assert.deepEqual(products(app.render()), []);
  assert.ok(byId(app.render(), "store-error"));
});

test("first search read failure retains a retry that resubmits the same query and unmount aborts it", async () => {
  const app = harness(); await open(app); submit(app, "ماء");
  app.read("store").resolve(store("store-a")); app.read().reject(new Error("OWNER_NETWORK_UNAVAILABLE")); await settle();
  assert.ok(byId(app.render(), "offers-error")); assert.equal(byId(app.render(), "offers-empty"), undefined);
  button(app.render(), "إعادة تحميل عروض المتجر").props.onPress(); app.render();
  const retry = app.read(); assert.equal(retry.query, "ماء"); assert.equal(retry.cursor, undefined);
  app.unmount(); assert.equal(retry.signal.aborted, true);
});
