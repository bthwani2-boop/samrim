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
  let effect;
  let deps;
  let cleanup;
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
        if (!deps || nextDeps.some((value, at) => value !== deps[at])) {
          deps = nextDeps;
          effect = next;
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
      if (effect) {
        cleanup?.();
        cleanup = effect();
        effect = undefined;
      }
      return view;
    },
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
