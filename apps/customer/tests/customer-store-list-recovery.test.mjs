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
  const categoryRequests = [];
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
      listPublicVerticals(_url, cityId, options) {
        return new Promise((resolve, reject) => categoryRequests.push({ cityId, ...options, resolve, reject }));
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
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
    read() {
      assert.ok(requests.length, "expected a Store list request");
      return requests.shift();
    },
    readCategory() {
      assert.ok(categoryRequests.length, "expected a DSH verticals read");
      return categoryRequests.shift();
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

test("DSH-admitted vertical choices filter Stores without guessing the category ID", async () => {
  const app = harness({ params: { city: "sanaa" } });
  app.render();
  const categories = app.readCategory();
  assert.equal(categories.cityId, "sanaa");
  app.read().resolve({ items: [], revision: 1 });
  categories.resolve({ items: [{ id: "grocery", storeCount: 2 }], revision: 1 });
  await settle();
  const ready = app.render();
  assert.ok(byId(ready, "vertical-option-grocery"));
  byId(ready, "vertical-option-grocery").props.onPress();
  app.render();
  const filtered = app.read();
  assert.equal(filtered.cityId, "sanaa");
  assert.equal(filtered.verticalId, "grocery");
});

test("Customer vertical choices paginate without treating a late city response as current", async () => {
  const app = harness({ params: { city: "sanaa" } });
  app.render();
  const first = app.readCategory();
  app.read().resolve({ items: [], revision: 1 });
  first.resolve({ items: [{ id: "grocery", storeCount: 2 }], revision: 1, nextCursor: "next-page" });
  await settle();
  const more = byId(app.render(), "vertical-options-more").props.onPress();
  const continuation = app.readCategory();
  assert.equal(continuation.cursor, "next-page");
  continuation.resolve({ items: [{ id: "pharmacy", storeCount: 1 }], revision: 1 });
  await more;
  assert.ok(byId(app.render(), "vertical-option-pharmacy"));

  app.setParams({ city: "aden" });
  app.render();
  app.render();
  const next = app.readCategory();
  assert.equal(next.cityId, "aden");
  assert.equal(continuation.signal.aborted, true);
  assert.equal(byId(app.render(), "vertical-option-grocery"), undefined);
  assert.equal(byId(app.render(), "vertical-option-pharmacy"), undefined);
  next.resolve({ items: [{ id: "restaurant", storeCount: 3 }], revision: 2 });
  await settle();
  assert.ok(byId(app.render(), "vertical-option-restaurant"));
});

test("changing the Store vertical requests a fresh DSH page and never shows old classification results", async () => {
  const app = harness({ params: { city: "sanaa", vertical: "grocery" } });
  app.render();
  const initial = app.read();
  assert.equal(initial.cityId, "sanaa");
  assert.equal(initial.verticalId, "grocery");
  initial.resolve({ items: [store("grocery-store")], nextCursor: "grocery-cursor", revision: 1 });
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 1 }, { id: "pharmacy", storeCount: 1 }], revision: 1 });
  await settle();
  const prior = app.render();
  assert.ok(byId(prior, "store-grocery-store"));
  const detailLink = find(prior, node => node.type === "Link" && node.props.href?.pathname === "/store/[id]");
  assert.equal(detailLink.props.href.params.vertical, "grocery");

  assert.equal(byId(prior, "vertical-option-grocery").props.accessibilityState.selected, true);
  byId(prior, "vertical-option-pharmacy").props.onPress();
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
  assert.equal(byId(filtered, "vertical-option-pharmacy").props.accessibilityState.selected, true);

  byId(filtered, "vertical-filter-clear").props.onPress();
  app.render();
  assert.equal(app.read().verticalId, undefined);
});

test("category navigation never requires customers to enter internal identifiers", async () => {
  const app = harness();
  app.render();
  app.read().resolve({ items: [], revision: 1 });
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 2 }], revision: 1 });
  await settle();
  const view = app.render();
  assert.equal(byId(view, "vertical-filter-input"), undefined);
  assert.equal(byId(view, "vertical-filter-apply"), undefined);
  assert.equal(byId(view, "vertical-filter-clear").props.accessibilityState.selected, true);
  assert.ok(byId(view, "vertical-option-grocery"));
});

test("an invalid deep-linked Store vertical is not submitted to DSH", () => {
  const app = harness({ params: { vertical: "../private" } });
  app.render();
  assert.equal(app.read().verticalId, undefined);
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

test("Customer Store directory rejects a repeated continuation or changed DSH revision before showing duplicate cards", async () => {
  for (const scenario of ["duplicate", "new-revision"]) {
    const app = harness();
    app.render();
    app.read().resolve({ items: [store("first")], nextCursor: "next-page", revision: 1 });
    await settle();
    const more = button(app.render(), "عرض المزيد").props.onPress();
    const next = app.read();
    next.resolve({ items: [store(scenario === "duplicate" ? "first" : "second")],
      revision: scenario === "duplicate" ? 1 : 2, nextCursor: "third-page" });
    await more;
    const invalid = app.render();
    assert.equal(byId(invalid, "store-first"), undefined, scenario);
    assert.ok(byId(invalid, "stores-error"), scenario);
    button(invalid, "إعادة المحاولة").props.onPress();
    app.render();
    const fresh = app.read();
    assert.equal(fresh.cursor, undefined, scenario);
  }
});

test("Customer vertical continuation invalidates a cross-page duplicate or changed revision", async () => {
  for (const scenario of ["duplicate", "new-revision"]) {
    const app = harness();
    app.render();
    const first = app.readCategory();
    app.read().resolve({ items: [], revision: 1 });
    first.resolve({ items: [{ id: "grocery", storeCount: 2 }], revision: 1, nextCursor: "next" });
    await settle();
    const loading = byId(app.render(), "vertical-options-more").props.onPress();
    const next = app.readCategory();
    next.resolve({ items: [{ id: scenario === "duplicate" ? "grocery" : "pharmacy", storeCount: 1 }],
      revision: scenario === "duplicate" ? 1 : 2, nextCursor: "more" });
    await loading;
    assert.equal(byId(app.render(), "vertical-option-grocery"), undefined, scenario);
    assert.ok(byId(app.render(), "vertical-options-retry"), scenario);
    byId(app.render(), "vertical-options-retry").props.onPress();
    app.render();
    const fresh = app.readCategory();
    assert.equal(fresh.cursor, undefined, scenario);
  }
});

test("account city shortcut opens the existing city selector and rejects a multi-value shortcut", () => {
  const app = harness({ params: { chooseCity: "1" } });
  assert.ok(find(app.render(), node => typeof node.props?.onApply === "function" && typeof node.props?.currentCity === "string"));
  const invalid = harness({ params: { chooseCity: ["1", "1"] } });
  assert.equal(find(invalid.render(), node => typeof node.props?.onApply === "function" && typeof node.props?.currentCity === "string"), undefined);
});

test("explicit city change drops old category and preserves submitted search", async () => {
  const app = harness({ params: { city: "sanaa", q: "مخبز", vertical: "grocery" } });
  app.render();
  const old = app.read();
  assert.equal(old.verticalId, "grocery");
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 2 }], revision: 1 });
  await settle();
  const changeCity = find(app.render(), node => node.props?.accessibilityLabel?.startsWith("تغيير مدينة التسوّق"));
  changeCity.props.onPress();
  find(app.render(), node => typeof node.props?.onApply === "function" && typeof node.props?.currentCity === "string").props.onApply("aden");
  const loading = app.render();
  const next = app.read();
  assert.equal(old.signal.aborted, true);
  assert.equal(next.cityId, "aden");
  assert.equal(next.query, "مخبز");
  assert.equal(next.verticalId, undefined);
  assert.equal(byId(loading, "vertical-filter-clear").props.accessibilityState.selected, true);
  old.resolve({ items: [store("old-city")], revision: 1 });
  next.resolve({ items: [{ ...store("new-city"), cityId: "aden" }], revision: 2 });
  await settle();
  const current = app.render();
  assert.equal(byId(current, "store-old-city"), undefined);
  assert.ok(byId(current, "store-new-city"));
  const home = find(current, node => node.type === "Link" && node.props.href?.pathname === "/");
  assert.deepEqual(home.props.href.params, { city: "aden", q: "مخبز" });
});

test("reopening the selector and choosing the same city does not lose its filter", async () => {
  const app = harness({ params: { city: "sanaa", vertical: "grocery" } });
  app.render();
  const old = app.read();
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 2 }], revision: 1 });
  await settle();
  find(app.render(), node => node.props?.accessibilityLabel?.startsWith("تغيير مدينة التسوّق")).props.onPress();
  find(app.render(), node => typeof node.props?.onApply === "function" && typeof node.props?.currentCity === "string").props.onApply("sanaa");
  assert.equal(byId(app.render(), "vertical-option-grocery").props.accessibilityState.selected, true);
  assert.equal(old.signal.aborted, false);
});

test("leaving the Store directory aborts active Store and vertical continuations", async () => {
  const app = harness();
  app.render();
  app.read().resolve({ items: [store("first")], nextCursor: "stores-next", revision: 1 });
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 2 }], nextCursor: "vertical-next", revision: 1 });
  await settle();
  const view = app.render();
  const storeMore = button(view, "عرض المزيد").props.onPress();
  const verticalMore = byId(view, "vertical-options-more").props.onPress();
  const stores = app.read();
  const verticals = app.readCategory();
  app.unmount();
  assert.equal(stores.signal.aborted, true, "active Store continuation must be aborted on unmount");
  assert.equal(verticals.signal.aborted, true, "active vertical continuation must be aborted on unmount");
  stores.resolve({ items: [store("late")], revision: 1 });
  verticals.resolve({ items: [{ id: "pharmacy", storeCount: 1 }], revision: 1 });
  await Promise.all([storeMore, verticalMore]);
});

test("superseded Store and vertical continuation callbacks cannot cancel a new city read", async () => {
  const app = harness();
  app.render();
  app.read().resolve({ items: [store("old")], nextCursor: "old-store-cursor", revision: 1 });
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 2 }], nextCursor: "old-vertical-cursor", revision: 1 });
  await settle();
  const old = app.render();
  const staleStore = button(old, "عرض المزيد").props.onPress;
  const staleVertical = byId(old, "vertical-options-more").props.onPress;
  app.setParams({ city: "aden" });
  app.render();
  app.render();
  const currentStore = app.read();
  const currentVertical = app.readCategory();
  const stale = staleStore();
  const staleV = staleVertical();
  assert.equal(currentStore.signal.aborted, false, "old Store callback cancelled the current city");
  assert.equal(currentVertical.signal.aborted, false, "old vertical callback cancelled the current city");
  await Promise.all([stale, staleV]);
  currentStore.resolve({ items: [{ ...store("current"), cityId: "aden" }], revision: 2 });
  currentVertical.resolve({ items: [{ id: "pharmacy", storeCount: 1 }], revision: 2 });
  await settle();
  assert.ok(byId(app.render(), "store-current"));
  assert.ok(byId(app.render(), "vertical-option-pharmacy"));
});

test("a duplicate Store or vertical continuation callback must not cancel the active continuation", async () => {
  const app = harness();
  app.render();
  app.read().resolve({ items: [store("first")], nextCursor: "stores-next", revision: 1 });
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 2 }], nextCursor: "vertical-next", revision: 1 });
  await settle();
  const ready = app.render();
  const loadStore = button(ready, "عرض المزيد").props.onPress;
  const loadVertical = byId(ready, "vertical-options-more").props.onPress;
  const storePending = loadStore();
  const verticalPending = loadVertical();
  const stores = app.read();
  const verticals = app.readCategory();
  const duplicateStore = loadStore();
  const duplicateVertical = loadVertical();
  assert.equal(stores.signal.aborted, false, "duplicate callback cancelled the Store read");
  assert.equal(verticals.signal.aborted, false, "duplicate callback cancelled the vertical read");
  stores.resolve({ items: [store("second")], revision: 1 });
  verticals.resolve({ items: [{ id: "pharmacy", storeCount: 1 }], revision: 1 });
  await Promise.all([storePending, verticalPending, duplicateStore, duplicateVertical]);
  assert.ok(byId(app.render(), "store-second"));
  assert.ok(byId(app.render(), "vertical-option-pharmacy"));
});

for (const variant of ["home", "directory"]) {
  test(`${variant}: explicit refresh reloads empty Store and vertical lists with the active scope`, async () => {
    const app = harness({ variant, params: { city: "aden", q: "مخبز", vertical: "grocery" } });
    app.render();
    app.read().resolve({ items: [], revision: 1 });
    app.readCategory().resolve({ items: [], revision: 1 });
    await settle();
    const empty = app.render();
    assert.ok(byId(empty, "stores-empty"));
    byId(empty, "stores-refresh").props.onPress();
    app.render();
    const stores = app.read();
    const verticals = app.readCategory();
    assert.equal(stores.cityId, "aden");
    assert.equal(stores.query, "مخبز");
    assert.equal(stores.verticalId, "grocery");
    assert.equal(stores.cursor, undefined);
    assert.equal(verticals.cityId, "aden");
    assert.equal(verticals.cursor, undefined);
    stores.resolve({ items: [{ ...store("new"), cityId: "aden" }], revision: 2 });
    verticals.resolve({ items: [{ id: "grocery", storeCount: 1 }], revision: 2 });
    await settle();
    assert.ok(byId(app.render(), "store-new"));
    assert.ok(byId(app.render(), "vertical-option-grocery"));
  });
}

test("refresh supersedes both active continuations and ignores their late responses", async () => {
  const app = harness();
  app.render();
  app.read().resolve({ items: [store("first")], nextCursor: "stores-next", revision: 1 });
  app.readCategory().resolve({ items: [{ id: "grocery", storeCount: 1 }], nextCursor: "vertical-next", revision: 1 });
  await settle();
  const ready = app.render();
  const more = button(ready, "عرض المزيد").props.onPress();
  const moreCategories = byId(ready, "vertical-options-more").props.onPress();
  const previous = app.read();
  const previousCategories = app.readCategory();
  byId(app.render(), "stores-refresh").props.onPress();
  app.render();
  assert.equal(previous.signal.aborted, true);
  assert.equal(previousCategories.signal.aborted, true);
  const current = app.read();
  const currentCategories = app.readCategory();
  previous.resolve({ items: [store("late")], revision: 1 });
  previousCategories.resolve({ items: [{ id: "pharmacy", storeCount: 1 }], revision: 1 });
  await Promise.all([more, moreCategories]);
  current.resolve({ items: [store("current")], revision: 2 });
  currentCategories.resolve({ items: [{ id: "restaurant", storeCount: 1 }], revision: 2 });
  await settle();
  const view = app.render();
  assert.ok(byId(view, "store-current"));
  assert.ok(byId(view, "vertical-option-restaurant"));
  assert.equal(byId(view, "store-late"), undefined);
  assert.equal(byId(view, "vertical-option-pharmacy"), undefined);
});
