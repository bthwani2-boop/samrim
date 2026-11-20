import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshPublicError } from "@bthwani/dsh";
import * as serviceability from "../src/features/location/serviceability.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../src/features/stores/stores-screen.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-store-list-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), entry,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "stores-screen.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function harness({ variant = "directory", params = {} } = {}) {
  const hooks = [];
  const requests = [];
  let index = 0;
  const effects = new Map();
  const effectDeps = new Map();
  const cleanups = new Map();
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const imports = {
    "@bthwani/dsh": {
      DshPublicError,
      listPublicStores(_url, cityId, options) {
        return new Promise((resolve, reject) => requests.push({ cityId, ...options, resolve, reject }));
      },
    },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "expo-router": { Link: "Link", useLocalSearchParams: () => params },
    react: {
      useState(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
      },
      useRef(initial) {
        const at = index++;
        hooks[at] ??= { current: initial };
        return hooks[at];
      },
      useEffect(next, nextDeps) {
        const at = index++;
        const previous = effectDeps.get(at);
        if (!previous || nextDeps.some((value, at) => value !== previous[at])) {
          effectDeps.set(at, nextDeps);
          effects.set(at, next);
        }
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView",
      Text: "Text", TextInput: "TextInput", View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../location/service-city-scope": { default: "ServiceCityScope" },
    "../location/serviceability": serviceability,
    "./orderability": { describeStoreOrderability: () => ({}) },
    "./public-store-origin": { resolvePublicStoreOrigin: () => "" },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(
    name => {
      assert.ok(Object.hasOwn(imports, name), `unexpected import ${name}`);
      return imports[name];
    }, mod, mod.exports, { env: { EXPO_PUBLIC_DSH_CITY_ID: "sanaa" } },
  );
  return {
    render() {
      index = 0;
      const view = mod.exports.default({ variant });
      for (const [at, effect] of effects) {
        cleanups.get(at)?.();
        cleanups.set(at, effect());
      }
      effects.clear();
      return view;
    },
    setParams(next) { Object.assign(params, next); },
    read() {
      assert.ok(requests.length, "expected a Store list request");
      return requests.shift();
    },
  };
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}

const byId = (view, id) => find(view, node => node.props?.testID === id);
const button = (view, text) => find(view, node =>
  node.type === "Pressable" && node.props.children?.props?.children === text);
const settle = () => new Promise(resolve => setImmediate(resolve));
const store = (id) => ({
  id, name: "متجر", cityId: "sanaa", verticalId: "restaurant",
  orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
});

test("home opens search on demand and links to the actual Notifications route", () => {
  const app = harness({ variant: "home" });
  const home = app.render();
  assert.equal(byId(home, "stores-search"), undefined);
  assert.ok(find(home, node => node.type === "Link" && node.props.href === "/notifications"));
  button(home, "بحث").props.onPress();
  assert.ok(byId(app.render(), "stores-search"));
});

test("submitted browsing context flows to the directory and owner-verified Store links", async () => {
  const app = harness({ variant: "home", params: { city: "aden", q: "مخبز" } });
  app.render();
  const request = app.read();
  assert.equal(request.cityId, "aden");
  assert.equal(request.query, "مخبز");
  request.resolve({ items: [{ ...store("bakery"), cityId: "aden" }], revision: 1 });
  await settle();
  const browse = app.render();
  const hrefFor = pathname => find(browse, node => node.type === "Link" && node.props.href?.pathname === pathname).props.href;
  assert.deepEqual(hrefFor("/stores"), { pathname: "/stores", params: { city: "aden", q: "مخبز" } });
  assert.deepEqual(hrefFor("/store/[id]"), {
    pathname: "/store/[id]", params: { city: "aden", q: "مخبز", id: "bakery" },
  });
});

for (const [status, code] of [[409, "STALE_CURSOR"], [400, "INVALID_CURSOR"]]) {
  test(`${code} clears Store cards and reloads the active search from its first page`, async () => {
    const app = harness();
    app.render();
    const initial = app.read();
    byId(app.render(), "stores-search").props.onChangeText("متجر");
    byId(app.render(), "stores-search").props.onSubmitEditing();
    app.render();
    assert.ok(initial.signal.aborted);

    const search = app.read();
    assert.equal(search.query, "متجر");
    search.resolve({ items: [store("old")], nextCursor: "next-page", revision: 1 });
    await settle();
    assert.ok(byId(app.render(), "store-old"));
    const pagination = button(app.render(), "عرض المزيد").props.onPress();
    const continuation = app.read();
    assert.equal(continuation.cursor, "next-page");
    continuation.reject(new DshPublicError(status, code));
    await pagination;

    const failed = app.render();
    assert.equal(byId(failed, "store-old"), undefined);
    assert.equal(byId(failed, "stores-empty"), undefined);
    assert.match(byId(failed, "stores-error").props.children, /تغيّرت البيانات/);
    button(failed, "إعادة المحاولة").props.onPress();
    app.render();
    const retry = app.read();
    assert.equal(retry.cityId, "sanaa");
    assert.equal(retry.query, "متجر");
    assert.equal(retry.cursor, undefined);
    retry.resolve({ items: [store("current")], revision: 2 });
    await settle();
    assert.ok(byId(app.render(), "store-current"));
    assert.equal(byId(app.render(), "stores-error"), undefined);
  });
}

test("a temporary continuation outage preserves the already read Store cards", async () => {
  const app = harness();
  app.render();
  app.read().resolve({ items: [store("first")], nextCursor: "next-page", revision: 1 });
  await settle();
  const pagination = button(app.render(), "عرض المزيد").props.onPress();
  app.read().reject(new DshPublicError(503, "OWNER_UNAVAILABLE"));
  await pagination;
  const failed = app.render();
  assert.ok(byId(failed, "store-first"));
  assert.ok(byId(failed, "stores-error"));
});

test("changing the Store vertical requests a fresh DSH page and never shows old classification results", async () => {
  const app = harness({ params: { city: "sanaa", vertical: "grocery" } });
  app.render();
  const initial = app.read();
  assert.equal(initial.cityId, "sanaa");
  assert.equal(initial.verticalId, "grocery");
  initial.resolve({ items: [store("grocery-store")], nextCursor: "grocery-cursor", revision: 1 });
  await settle();
  const prior = app.render();
  assert.ok(byId(prior, "store-grocery-store"));
  const detailLink = find(prior, node => node.type === "Link" && node.props.href?.pathname === "/store/[id]");
  assert.equal(detailLink.props.href.params.vertical, "grocery");

  byId(prior, "vertical-filter-input").props.onChangeText("pharmacy");
  byId(app.render(), "vertical-filter-apply").props.onPress();
  const changing = app.render();
  assert.equal(byId(changing, "store-grocery-store"), undefined);
  assert.equal(initial.signal.aborted, true);
  const current = app.read();
  assert.equal(current.verticalId, "pharmacy");
  assert.equal(current.cursor, undefined);
  current.resolve({ items: [{ ...store("pharmacy-store"), verticalId: "pharmacy" }], revision: 2 });
  await settle();
  const filtered = app.render();
  assert.ok(byId(filtered, "store-pharmacy-store"));
  assert.equal(byId(filtered, "store-grocery-store"), undefined);

  byId(filtered, "vertical-filter-clear").props.onPress();
  app.render();
  assert.equal(app.read().verticalId, undefined);
});

test("an invalid Store vertical is not submitted to DSH", () => {
  const app = harness();
  app.render();
  app.read();
  byId(app.render(), "vertical-filter-input").props.onChangeText("../private");
  byId(app.render(), "vertical-filter-apply").props.onPress();
  const invalid = app.render();
  assert.ok(find(invalid, node => node.props.accessibilityRole === "alert"));
  assert.equal(byId(invalid, "vertical-filter-clear"), undefined);
});

test("route navigation changes the DSH Store query without exposing old-city results", async () => {
  const app = harness({ params: { city: "sanaa", q: "old" } });
  app.render();
  const first = app.read();
  first.resolve({ items: [store("previous")], revision: 1 });
  await settle();
  assert.ok(byId(app.render(), "store-previous"));

  app.setParams({ city: "aden", q: "new" });
  const navigating = app.render();
  assert.equal(byId(navigating, "store-previous"), undefined);
  app.render();
  const next = app.read();
  assert.equal(next.cityId, "aden");
  assert.equal(next.query, "new");
  next.resolve({ items: [{ ...store("current"), cityId: "aden" }], revision: 2 });
  await settle();
  const current = app.render();
  assert.ok(byId(current, "store-current"));
  assert.equal(byId(current, "store-previous"), undefined);
});

test("route change aborts an in-flight DSH read and discards its late response", async () => {
  const app = harness({ params: { city: "sanaa" } });
  app.render();
  const old = app.read();
  app.setParams({ city: "aden" });
  assert.equal(byId(app.render(), "store-stale"), undefined);
  app.render();
  assert.equal(old.signal.aborted, true);
  const next = app.read();
  assert.equal(next.cityId, "aden");
  old.resolve({ items: [store("stale")], revision: 1 });
  await settle();
  assert.equal(byId(app.render(), "store-stale"), undefined);
  next.resolve({ items: [{ ...store("fresh"), cityId: "aden" }], revision: 2 });
  await settle();
  assert.ok(byId(app.render(), "store-fresh"));
});
