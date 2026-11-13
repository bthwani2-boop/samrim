import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// Unit-test the actual controller without introducing a Native renderer or a second test runtime.
// Node 24 strips types from the controller part; the React provider with JSX remains out of scope.
const source = readFileSync(fileURLToPath(new URL("../src/appearance.tsx", import.meta.url)), "utf8");
const providerBoundary = source.indexOf("const AppearanceContext");
assert.ok(providerBoundary > 0, "Appearance controller boundary missing");
const controllerSource = source.slice(0, providerBoundary)
  .replace(/^import .*?;\r?\n/gm, "")
  .replace(/^export /gm, "");
const compiled = stripTypeScriptTypes(controllerSource, { mode: "strip" });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(storage = { getItem: async () => null, setItem: async () => {} }) {
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
  const factory = runInNewContext(
    "(function(Appearance, Platform, isThemePreference, resolveTheme, resolveThemeName) {\n" +
    compiled + "\nreturn createMobileAppearanceController;\n})", {}
  );
  const create = factory(
    appearance,
    { OS: "android" },
    value => ["system", "light", "dark"].includes(value),
    (value) => ({ value }),
    (value, system) => value === "system" ? (system === "dark" ? "dark" : "light") : value,
  );
  const controller = create({ key: "test.theme", storage });
  return {
    controller,
    applied,
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
