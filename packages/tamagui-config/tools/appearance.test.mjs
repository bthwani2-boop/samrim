import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

// Execute the original TSX source instead of an anonymous VM excerpt.
const root = fileURLToPath(new URL("../../..", import.meta.url));
const sourceFile = fileURLToPath(new URL("../src/appearance.tsx", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "bthwani-appearance-test-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    join(root, "node_modules/typescript/bin/tsc"), sourceFile,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", scratch,
  ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
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
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(storage = { getItem: async () => null, setItem: async () => {} }, platform = "android") {
  let onSchemeChanged;
  let disposedSubscription = false;
  const applied = [];
  const appearance = {
    getColorScheme: () => "light",
    setColorScheme: value => applied.push(value),
    addChangeListener: callback => {
      onSchemeChanged = callback;
      return { remove: () => { disposedSubscription = true; } };
    },
  };
  const jsx = (type, props) => ({ type, props });
  const module = loadMappedRenderFixture(compiled, sourceFile, {
    "@bthwani/design-system/theme": {
      isThemePreference: value => ["system", "light", "dark"].includes(value),
      resolveTheme: value => ({ value }),
      resolveThemeName: (value, system) => value === "system" ? (system === "dark" ? "dark" : "light") : value,
    },
    react: { createContext: initial => ({ initial, Provider: "AppearanceContext" }) },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Appearance: appearance, Platform: { OS: platform } },
    tamagui: { TamaguiProvider: "TamaguiProvider", Theme: "Theme" },
    "./index": { tamaguiConfig: {} },
  });
  loaded.push(module);
  const create = module.exports.createMobileAppearanceController;
  const controller = create({ key: "test.theme", storage });
  return {
    controller,
    applied,
    subscribed: () => typeof onSchemeChanged === "function",
    setSystemTheme: value => onSchemeChanged({ colorScheme: value }),
    wasSubscriptionRemoved: () => disposedSubscription,
  };
}

test("restores a persisted preference and marks initialization ready", async () => {
  const { controller } = harness({ getItem: async () => "dark", setItem: async () => {} });
  await controller.restore();
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.equal(controller.getSnapshot().themeName, "dark");
  assert.equal(controller.getSnapshot().ready, true);
  controller.dispose();
});

test("slow restore must not overwrite a newer user choice", async () => {
  const read = deferred();
  let persisted;
  const { controller } = harness({
    getItem: () => read.promise,
    setItem: async (_, value) => { persisted = value; },
  });
  const restoring = controller.restore();
  await controller.setPreference("dark");
  read.resolve("light");
  await restoring;
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(persisted, "dark");
  controller.dispose();
});

test("explicit system choice during a pending restore beats older stored dark", async () => {
  const read = deferred();
  let persisted;
  const { controller } = harness({
    getItem: () => read.promise,
    setItem: async (_, value) => { persisted = value; },
  });
  const restoring = controller.restore();
  await controller.setPreference("system");
  read.resolve("dark");
  await restoring;
  assert.equal(controller.getSnapshot().preference, "system");
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(persisted, "system");
  controller.dispose();
});

test("concurrent changes persist in user intent order, not completion order", async () => {
  const first = deferred();
  const writes = [];
  let persisted;
  const { controller } = harness({
    getItem: async () => null,
    setItem: async (_, value) => {
      writes.push(value);
      if (value === "light") await first.promise;
      persisted = value;
    },
  });
  const light = controller.setPreference("light");
  const dark = controller.setPreference("dark");
  await Promise.resolve();
  assert.equal(controller.getSnapshot().preference, "dark");
  assert.deepEqual(writes, ["light"]);
  first.resolve();
  await Promise.all([light, dark]);
  assert.deepEqual(writes, ["light", "dark"]);
  assert.equal(persisted, "dark");
  controller.dispose();
});

test("a failed old write must not revert a newer successful choice", async () => {
  const first = deferred();
  const { controller } = harness({
    getItem: async () => null,
    setItem: (_, value) => value === "light" ? first.promise : Promise.resolve(),
  });
  const light = controller.setPreference("light");
  const dark = controller.setPreference("dark");
  await Promise.resolve();
  first.reject(new Error("storage failure"));
  await assert.rejects(light, /storage failure/);
  await dark;
  assert.equal(controller.getSnapshot().preference, "dark");
  controller.dispose();
});

test("latest failed write restores last confirmed preference", async () => {
  const { controller } = harness({
    getItem: async () => null,
    setItem: async (_, value) => {
      if (value === "dark") throw new Error("no storage");
    },
  });
  await controller.setPreference("light");
  await assert.rejects(controller.setPreference("dark"), /no storage/);
  assert.equal(controller.getSnapshot().preference, "light");
  assert.equal(controller.getSnapshot().ready, true);
  controller.dispose();
});

test("disposed controller ignores an incomplete restore and releases listener", async () => {
  const read = deferred();
  const { controller, wasSubscriptionRemoved } = harness({
    getItem: () => read.promise,
    setItem: async () => {},
  });
  const restoring = controller.restore();
  controller.dispose();
  read.resolve("dark");
  await restoring;
  assert.equal(controller.getSnapshot().preference, "system");
  assert.equal(wasSubscriptionRemoved(), true);
  await assert.rejects(controller.setPreference("dark"), /disposed/);
});

test("system preference responds to the platform scheme without a second theme store", async () => {
  const { controller, setSystemTheme } = harness();
  await controller.restore();
  setSystemTheme("dark");
  assert.equal(controller.getSnapshot().themeName, "dark");
  setSystemTheme("light");
  assert.equal(controller.getSnapshot().themeName, "light");
  controller.dispose();
});

test("identical pending preference requests wait for the same durable save and share failure", async () => {
  const pending = deferred();
  const writes = [];
  const { controller } = harness({
    getItem: async () => "light",
    setItem: (_, value) => { writes.push(value); return pending.promise; },
  });
  await controller.restore();
  const first = controller.setPreference("dark");
  let settled = false;
  const second = controller.setPreference("dark");
  const observed = second.then(() => { settled = true; }, () => { settled = true; });
  const failures = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  const premature = settled;
  pending.reject(new Error("storage failure"));
  const results = await failures;
  await observed;
  assert.equal(premature, false);
  assert.deepEqual(results.map(result => result.status), ["rejected", "rejected"]);
  assert.deepEqual(writes, ["dark"]);
  assert.equal(controller.getSnapshot().preference, "light");
  controller.dispose();
});

test("identical pending preference requests share successful persistence without duplicate writes", async () => {
  const pending = deferred();
  const writes = [];
  const { controller } = harness({
    getItem: async () => null,
    setItem: (_, value) => { writes.push(value); return pending.promise; },
  });
  await controller.restore();
  const first = controller.setPreference("dark");
  let settled = false;
  const second = controller.setPreference("dark").then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  const premature = settled;
  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(premature, false);
  await controller.setPreference("dark");
  assert.deepEqual(writes, ["dark"]);
  assert.equal(controller.getSnapshot().preference, "dark");
  controller.dispose();
});

test("appearance subscribers observe changes; unsubscribe and invalid choices do not mutate state", async () => {
  const { controller, applied } = harness();
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
  controller.dispose();
});

test("unavailable or invalid stored preference falls back to system and still renders", async () => {
  for (const getItem of [async () => { throw new Error("unavailable"); }, async () => "invalid"]) {
    const { controller, applied } = harness({ getItem, setItem: async () => {} });
    await controller.restore();
    assert.equal(controller.getSnapshot().preference, "system");
    assert.equal(controller.getSnapshot().ready, true);
    assert.deepEqual(applied, ["unspecified"]);
    controller.dispose();
  }
});

test("server rendering creates no process-wide native appearance subscription", () => {
  assert.equal(typeof window, "undefined");
  const { controller, subscribed, wasSubscriptionRemoved } = harness(undefined, "web");
  assert.equal(subscribed(), false);
  assert.equal(controller.getSnapshot().ready, false);
  controller.dispose();
  assert.equal(wasSubscriptionRemoved(), false);
});
