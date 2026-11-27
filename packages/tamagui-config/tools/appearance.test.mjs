import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

// Compile the original source with its verified source map for native LCOV.
const root = fileURLToPath(new URL("../../..", import.meta.url));
const sourceFile = fileURLToPath(new URL("../src/appearance.tsx", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "bthwani-appearance-test-"));
let compiled;
try {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      sourceFile,
      "--ignoreConfig",
      "--noResolve",
      "--noCheck",
      "--target",
      "es2022",
      "--module",
      "commonjs",
      "--jsx",
      "react-jsx",
      "--inlineSourceMap",
      "--inlineSources",
      "--outDir",
      scratch,
    ],
    { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(join(scratch, "appearance.js"), "utf8");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const loaded = [];
process.once("exit", () => loaded.length);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noStorage = { getItem: async () => null, setItem: async () => {} };

function fixture({ platform = "android", nativeSetter = true } = {}) {
  let scheme = "light";
  const applied = [];
  const subscriptions = new Set();
  const effects = [];
  let context;
  let serverSnapshot = false;
  const appearance = {
    getColorScheme: () => scheme,
    addChangeListener(callback) {
      subscriptions.add(callback);
      return { remove: () => subscriptions.delete(callback) };
    },
    ...(nativeSetter ? { setColorScheme: (value) => applied.push(value) } : {}),
  };
  const jsx = (type, props) => ({ type, props });
  const react = {
    createContext(initial) {
      context = { value: initial, Provider: "AppearanceContext" };
      return context;
    },
    useContext: (value) => value.value,
    useMemo: (factory) => factory(),
    useEffect: (effect) => effects.push(effect),
    useSyncExternalStore: (_subscribe, get, getServer) => (serverSnapshot ? getServer() : get()),
  };
  const module = loadMappedRenderFixture(compiled, sourceFile, {
    "@bthwani/design-system/theme": {
      isThemePreference: (value) => ["system", "light", "dark"].includes(value),
      resolveTheme: (value) => ({ value, background: value }),
      resolveThemeName: (value, system) => (value === "system" ? (system === "dark" ? "dark" : "light") : value),
    },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Appearance: appearance, Platform: { OS: platform } },
    tamagui: { TamaguiProvider: "TamaguiProvider", Theme: "Theme" },
    "./index": { tamaguiConfig: {} },
  });
  loaded.push(module);
  return {
    api: module.exports,
    applied,
    effects,
    subscriptions,
    setContext: (controller) => { context.value = controller; },
    useServerSnapshot: () => { serverSnapshot = true; },
    setSystemTheme(value) {
      scheme = value;
      for (const callback of subscriptions) callback({ colorScheme: value });
    },
  };
}

function harness(storage = noStorage, options = {}) {
  const env = fixture(options);
  const controller = env.api.createMobileAppearanceController({ key: "test.theme", storage });
  const unmount = controller.mount();
  return { ...env, controller, unmount };
}

test("restoration reads the original key and initializes the selected theme", async () => {
  const reads = [];
  const { controller, applied, unmount } = harness({
    getItem: async (key) => { reads.push(key); return "dark"; },
    setItem: async () => {},
  });
  await controller.restore();
  assert.deepEqual(reads, ["test.theme"]);
  assert.deepEqual(controller.getSnapshot(), {
    preference: "dark", themeName: "dark", theme: { value: "dark", background: "dark" }, ready: true,
  });
  assert.deepEqual(applied, ["dark"]);
  unmount();
});

test("pending initial restoration cannot overwrite a newer user choice", async () => {
  for (const [choice, previous] of [["dark", "light"], ["system", "dark"]]) {
    const read = deferred();
    let persisted;
    const { controller, unmount } = harness({
      getItem: () => read.promise,
      setItem: async (_, value) => { persisted = value; },
    });
    const restoring = controller.restore();
    await controller.setPreference(choice);
    read.resolve(previous);
    await restoring;
    assert.equal(controller.getSnapshot().preference, choice);
    assert.equal(controller.getSnapshot().ready, true);
    assert.equal(persisted, choice);
    unmount();
  }
});

test("concurrent writes persist in user intent order", async () => {
  const first = deferred();
  const writes = [];
  let persisted;
  const { controller, unmount } = harness({
    getItem: async () => null,
    setItem: async (key, value) => {
      writes.push([key, value]);
      if (value === "light") await first.promise;
      persisted = value;
    },
  });
  const light = controller.setPreference("light");
  const dark = controller.setPreference("dark");
  await Promise.resolve();
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.deepEqual(writes, [["test.theme", "light"]]);
  first.resolve();
  await Promise.all([light, dark]);
  assert.deepEqual(writes, [["test.theme", "light"], ["test.theme", "dark"]]);
  assert.equal(persisted, "dark");
  unmount();
});

test("failed old write does not revert a newer choice", async () => {
  const first = deferred();
  const { controller, unmount } = harness({
    getItem: async () => null,
    setItem: (_, value) => (value === "light" ? first.promise : Promise.resolve()),
  });
  const light = controller.setPreference("light");
  const dark = controller.setPreference("dark");
  const failure = assert.rejects(light, /storage failure/);
  first.reject(new Error("storage failure"));
  await failure;
  await dark;
  assert.equal(controller.getSnapshot().preference, "dark");
  unmount();
});

test("latest failed write restores confirmed preference and supports retry", async () => {
  let rejectDark = true;
  const { controller, applied, unmount } = harness({
    getItem: async () => null,
    setItem: async (_, value) => {
      if (rejectDark && value === "dark") throw new Error("no storage");
    },
  });
  await controller.setPreference("light");
  await assert.rejects(controller.setPreference("dark"), /no storage/);
  assert.equal(controller.getSnapshot().preference, "light");
  assert.equal(controller.getSnapshot().ready, true);
  rejectDark = false;
  await controller.setPreference("dark");
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.deepEqual(applied, ["light", "dark", "light", "dark"]);
  unmount();
});

test("unmounted controller ignores unfinished restore and rejects new writes", async () => {
  const read = deferred();
  const { controller, subscriptions, applied, unmount } = harness({
    getItem: () => read.promise,
    setItem: async () => {},
  });
  const restoring = controller.restore();
  unmount();
  read.resolve("dark");
  await restoring;
  assert.equal(controller.getSnapshot().preference, "system");
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(subscriptions.size, 0);
  assert.deepEqual(applied, []);
  await assert.rejects(controller.setPreference("dark"), /not mounted/);
  await controller.restore();
  assert.equal(controller.getSnapshot().ready, false);
});

test("system preference follows current scheme while explicit choices remain stable", async () => {
  const { controller, setSystemTheme, unmount } = harness();
  await controller.restore();
  setSystemTheme("dark");
  assert.equal(controller.getSnapshot().themeName, "dark");
  setSystemTheme("light");
  assert.equal(controller.getSnapshot().themeName, "light");
  await controller.setPreference("dark");
  setSystemTheme("light");
  assert.equal(controller.getSnapshot().themeName, "dark");
  await controller.setPreference("system");
  assert.equal(controller.getSnapshot().themeName, "light");
  unmount();
});

for (const outcome of ["success", "failure"]) {
  test(`identical pending preference requests share one durable ${outcome}`, async () => {
    const pending = deferred();
    const writes = [];
    const { controller, unmount } = harness({
      getItem: async () => "light",
      setItem: (_, value) => { writes.push(value); return pending.promise; },
    });
    await controller.restore();
    const first = controller.setPreference("dark");
    let settled = false;
    const second = controller.setPreference("dark");
    const observed = second.then(() => { settled = true; }, () => { settled = true; });
    const results = Promise.allSettled([first, second]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    if (outcome === "failure") pending.reject(new Error("storage failure"));
    else pending.resolve();
    const saved = await results;
    await observed;
    const status = outcome === "failure" ? "rejected" : "fulfilled";
    assert.deepEqual(saved.map((result) => result.status), [status, status]);
    assert.deepEqual(writes, ["dark"]);
    assert.equal(controller.getSnapshot().preference, outcome === "failure" ? "light" : "dark");
    if (outcome === "success") {
      await controller.setPreference("dark");
      assert.deepEqual(writes, ["dark"]);
    }
    unmount();
  });
}

test("subscribers observe changes; unsubscribe and invalid choice leave state intact", async () => {
  const { controller, applied, unmount } = harness();
  const observed = [];
  const unsubscribe = controller.subscribe(() => observed.push(controller.getSnapshot().preference));
  await controller.restore();
  await controller.setPreference("dark");
  unsubscribe();
  await controller.setPreference("light");
  await assert.rejects(controller.setPreference("invalid"), /Invalid theme preference/);
  assert.deepEqual(observed, ["system", "dark"]);
  assert.deepEqual(applied, ["unspecified", "dark", "light"]);
  assert.equal(controller.getSnapshot().preference, "light");
  unmount();
});

test("invalid, absent or unavailable storage initializes system without a second read", async () => {
  for (const getItem of [async () => { throw new Error("unavailable"); }, async () => "invalid", async () => null]) {
    let reads = 0;
    const { controller, applied, unmount } = harness({
      getItem: () => { reads++; return getItem(); },
      setItem: async () => {},
    });
    await controller.restore();
    await controller.restore();
    assert.equal(controller.getSnapshot().preference, "system");
    assert.equal(controller.getSnapshot().ready, true);
    assert.deepEqual(applied, ["unspecified"]);
    assert.equal(reads, 1);
    unmount();
  }
});

test("render-only construction has no subscriptions or native writes on Web or Android", () => {
  for (const platform of ["web", "android"]) {
    const { api, subscriptions, applied } = fixture({ platform });
    const controller = api.createMobileAppearanceController({ key: "test.theme", storage: noStorage });
    assert.equal(controller.getSnapshot().ready, false);
    assert.equal(subscriptions.size, 0);
    assert.deepEqual(applied, []);
  }
});

test("replayed restore cannot overwrite a pending or committed user intent", async () => {
  const pending = deferred();
  let reads = 0;
  let stored = "light";
  const { controller, unmount } = harness({
    getItem: async () => { reads++; return stored; },
    setItem: async (_, value) => { await pending.promise; stored = value; },
  });
  await controller.restore();
  const saving = controller.setPreference("dark");
  await controller.restore();
  const during = controller.getSnapshot().preference;
  pending.resolve();
  await saving;
  await controller.restore();
  assert.equal(during, "dark");
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.equal(stored, "dark");
  assert.equal(reads, 1);
  unmount();
});

test("concurrent initial restoration reads storage once", async () => {
  const pending = deferred();
  let reads = 0;
  const { controller, unmount } = harness({
    getItem: () => { reads++; return pending.promise; },
    setItem: async () => {},
  });
  const first = controller.restore();
  const second = controller.restore();
  pending.resolve("dark");
  await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(controller.getSnapshot().preference, "dark");
  unmount();
});

test("effect cleanup and replay retain one subscription and one initial read", async () => {
  const pending = deferred();
  let reads = 0;
  const { api, subscriptions, applied } = fixture();
  const controller = api.createMobileAppearanceController({
    key: "test.theme",
    storage: { getItem: () => { reads++; return pending.promise; }, setItem: async () => {} },
  });
  const firstUnmount = controller.mount();
  const staleEvent = [...subscriptions][0];
  const firstRestore = controller.restore();
  assert.throws(() => controller.mount(), /already mounted/);
  firstUnmount();
  assert.equal(subscriptions.size, 0);
  const secondUnmount = controller.mount();
  const secondRestore = controller.restore();
  firstUnmount();
  staleEvent({ colorScheme: "dark" });
  assert.equal(controller.getSnapshot().themeName, "light");
  assert.equal(subscriptions.size, 1);
  pending.resolve("dark");
  await Promise.all([firstRestore, secondRestore]);
  assert.equal(reads, 1);
  assert.deepEqual(applied, ["dark"]);
  assert.equal(controller.getSnapshot().ready, true);
  secondUnmount();
  assert.equal(subscriptions.size, 0);
});

test("completed read during unmount can be applied on remount without another read", async () => {
  const pending = deferred();
  let reads = 0;
  const { controller, unmount, applied } = harness({
    getItem: () => { reads++; return pending.promise; },
    setItem: async () => {},
  });
  const restoring = controller.restore();
  unmount();
  pending.resolve("dark");
  await restoring;
  const cleanup = controller.mount();
  await controller.restore();
  assert.equal(reads, 1);
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.deepEqual(applied, ["dark"]);
  cleanup();
});

test("unmounted failed save rolls back silently and remount reapplies confirmed preference", async () => {
  const pending = deferred();
  const { controller, unmount, applied, subscriptions } = harness({
    getItem: async () => "light",
    setItem: () => pending.promise,
  });
  await controller.restore();
  const saving = controller.setPreference("dark");
  const failure = assert.rejects(saving, /save failed/);
  unmount();
  pending.reject(new Error("save failed"));
  await failure;
  assert.deepEqual(applied, ["light", "dark"]);
  assert.equal(subscriptions.size, 0);
  const cleanup = controller.mount();
  await controller.restore();
  assert.deepEqual(applied, ["light", "dark", "light"]);
  assert.equal(controller.getSnapshot().preference, "light");
  cleanup();
});

test("native appearance setter is optional; storage still owns intent", async () => {
  const { controller, unmount } = harness(noStorage, { nativeSetter: false });
  await controller.restore();
  await controller.setPreference("dark");
  assert.equal(controller.getSnapshot().themeName, "dark");
  unmount();
});

test("provider wires mount cleanup, stable server snapshot and renderer to the same controller", async () => {
  const { api, effects, subscriptions, setContext, useServerSnapshot } = fixture();
  assert.throws(() => api.useMobileAppearance(), /AppearanceProvider required/);
  const rootLayout = api.createMobileAppearanceRoot(
    "native.theme",
    async (key) => { assert.equal(key, "native.theme"); return "dark"; },
    async () => {},
    (background) => ({ background }),
  );
  const layout = rootLayout();
  const controller = layout.props.controller;
  assert.equal(subscriptions.size, 0);
  const provider = layout.type(layout.props);
  assert.equal(provider.props.value, controller);
  setContext(controller);
  const cleanup = effects.shift()();
  await controller.restore();
  const route = layout.props.children.type();
  assert.equal(route.props.children.background, "dark");
  const rendered = route.type(route.props);
  assert.equal(rendered.props.defaultTheme, "dark");
  assert.equal(rendered.props.children.props.name, "dark");
  useServerSnapshot();
  const server = api.useMobileAppearance();
  assert.equal(server.themeName, "light");
  assert.equal(server.ready, false);
  assert.equal(server.setPreference, controller.setPreference);
  cleanup();
  assert.equal(subscriptions.size, 0);
});

test("Web root uses only its app-scoped localStorage key after mount", async () => {
  const { api, effects, subscriptions, setContext } = fixture({ platform: "web" });
  const store = new Map([["web.theme", "dark"], ["other.theme", "light"]]);
  const prior = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
  };
  try {
    const forbidden = async () => { throw new Error("native storage called on Web"); };
    const RootLayout = api.createMobileAppearanceRoot("web.theme", forbidden, forbidden, (background) => background);
    const layout = RootLayout();
    assert.equal(subscriptions.size, 0);
    layout.type(layout.props);
    const controller = layout.props.controller;
    setContext(controller);
    const cleanup = effects.shift()();
    await controller.restore();
    assert.equal(controller.getSnapshot().preference, "dark");
    await controller.setPreference("light");
    assert.equal(store.get("web.theme"), "light");
    assert.equal(store.get("other.theme"), "light");
    cleanup();
    assert.equal(subscriptions.size, 0);
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
});

test("Web storage is lazy, scoped, and recovers from synchronous access and write failures", async () => {
  const { api, effects, subscriptions } = fixture({ platform: "web" });
  const store = new Map([["web.theme", "dark"], ["other.theme", "light"]]);
  const prior = globalThis.window;
  let reads = 0;
  let failAccess = true;
  let failWrite = false;
  globalThis.window = {
    get localStorage() {
      reads++;
      if (failAccess) throw new Error("storage denied");
      return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          if (failWrite) throw new Error("storage full");
          store.set(key, value);
        },
      };
    },
  };
  try {
    const forbidden = async () => { throw new Error("native storage called on Web"); };
    const RootLayout = api.createMobileAppearanceRoot("web.theme", forbidden, forbidden, (background) => background);
    const layout = RootLayout();
    const controller = layout.props.controller;
    assert.equal(reads, 0, "construction must not access browser storage");
    assert.equal(subscriptions.size, 0);
    layout.type(layout.props);
    const cleanup = effects.shift()();
    try {
      await controller.restore();
      assert.equal(controller.getSnapshot().preference, "system");
      assert.equal(controller.getSnapshot().ready, true);
      failAccess = false;
      await controller.setPreference("light");
      assert.equal(store.get("web.theme"), "light");
      failWrite = true;
      await assert.rejects(controller.setPreference("dark"), /storage full/);
      assert.equal(controller.getSnapshot().preference, "light");
      assert.equal(store.get("web.theme"), "light");
      failWrite = false;
      await controller.setPreference("dark");
      assert.equal(store.get("web.theme"), "dark");
      assert.equal(store.get("other.theme"), "light");
    } finally {
      cleanup();
    }
    assert.equal(subscriptions.size, 0);
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
});
