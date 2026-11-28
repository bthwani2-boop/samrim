import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import * as radioGroup from "../src/radio-group.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const source = fileURLToPath(new URL("../src/appearance-preferences.tsx", import.meta.url));

function compileAppearancePreferences() {
  const temp = mkdtempSync(path.join(tmpdir(), "appearance-preferences-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout || `Compiler exited with signal ${result.signal}`);
    return readFileSync(path.join(temp, "appearance-preferences.js"), "utf8");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const compiled = compileAppearancePreferences();

function harness({ ready = true, platform = "web", save = async () => {} } = {}) {
  const jsx = (type, props) => ({ type, props });
  let preference = "system", slot = 0;
  const states = [], writes = [];
  const ownerDocument = { activeElement: null };
  const hosts = Array.from({ length: 3 }, () => ({
    ownerDocument,
    focus() { ownerDocument.activeElement = this; },
  }));
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: {
      useState(initial) {
        const i = slot++;
        if (!(i in states)) states[i] = initial;
        return [states[i], value => { states[i] = value; }];
      },
      useRef(initial) {
        const i = slot++;
        if (!(i in states)) states[i] = { current: initial };
        return states[i];
      },
    },
    "react-native": { Platform: { OS: platform }, Pressable: "Pressable", Text: "Text", View: "View" },
    "./radio-group": radioGroup,
    "./appearance": {
      useMobileAppearance: () => ({
        theme: {}, ready, preference,
        async setPreference(next) {
          writes.push(next);
          await save(next);
          preference = next;
        },
      }),
    },
  };
  const mod = loadMappedRenderFixture(compiled, source, mocks);
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ?
    tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const render = () => {
    slot = 0;
    const result = nodes(mod.exports.default());
    result.filter(n => n.props?.accessibilityRole === "radio")
      .forEach((n, i) => { n.props.ref?.(hosts[i]); });
    return result;
  };
  const radios = () => render().filter(n => n.props?.accessibilityRole === "radio");
  return {
    writes, render, radios, hosts, ownerDocument,
    key(index, key) {
      let prevented = false;
      radios()[index].props.onKeyDown?.({ nativeEvent: { key }, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
}

const labels = ["حسب النظام", "فاتح", "داكن"];
const flush = () => new Promise(resolve => setImmediate(resolve));
function assertChoices(app, expected) {
  const radios = app.radios();
  assert.deepEqual(radios.map(r => r.props.accessibilityLabel), labels);
  assert.deepEqual(radios.map(r => r.props["aria-checked"]), expected);
  assert.deepEqual(radios.map(r => r.props.accessibilityState.checked), expected);
}
function assertTabs(app, expected) {
  assert.deepEqual(app.radios().map(r => r.props.tabIndex), expected);
}

test("Shared appearance exposes named radios with one Web and native checked choice", async () => {
  for (const platform of ["web", "android"]) {
    const app = harness({ platform });
    assertChoices(app, [true, false, false]);
    app.radios()[2].props.onPress();
    await flush();
    assertChoices(app, [false, false, true]);
    app.radios()[1].props.onPress();
    await flush();
    assertChoices(app, [false, true, false]);
    app.radios()[0].props.onPress();
    await flush();
    assertChoices(app, [true, false, false]);
    assert.deepEqual(app.writes, ["dark", "light", "system"]);
    if (platform === "android") {
      assert.ok(app.radios().every(r => r.props.tabIndex === undefined && r.props.onKeyDown === undefined));
    }
  }
});

test("Shared appearance disables writes while restoring or saving and recovers from rejection", async () => {
  const restoring = harness({ ready: false });
  const initial = restoring.radios();
  assert.ok(initial.every(r => r.props.disabled));
  initial[2].props.onPress();
  assert.deepEqual(restoring.writes, []);
  let settle;
  const app = harness({ save: () => new Promise((resolve, reject) => {
    settle = success => success ? resolve() : reject(new Error("storage unavailable"));
  }) });
  const options = app.radios();
  options[2].props.onPress();
  assert.ok(app.radios().every(r => r.props.disabled));
  assert.ok(app.render().some(n => n.props?.accessibilityLiveRegion === "polite"), "pending save must be announced");
  options[1].props.onPress();
  assert.deepEqual(app.writes, ["dark"]);
  settle(false);
  await flush();
  assertChoices(app, [true, false, false]);
  assert.ok(app.render().some(n => n.props?.accessibilityRole === "alert"));
  assert.ok(app.radios().every(r => !r.props.disabled));
  app.radios()[2].props.onPress();
  settle(true);
  await flush();
  assertChoices(app, [false, false, true]);
  assert.deepEqual(app.writes, ["dark", "dark"]);
  assert.ok(!app.render().some(n => n.props?.accessibilityRole === "alert"));
});

test("Web radio group has one tab stop and arrows move focus and choice with wrapping", async () => {
  const app = harness();
  assertTabs(app, [0, -1, -1]);
  app.hosts[0].focus();
  for (const [from, key, to] of [[0, "ArrowLeft", 2], [2, "ArrowDown", 0], [0, "ArrowRight", 1], [1, "ArrowUp", 0]]) {
    assert.equal(app.key(from, key), true);
    await flush();
    assert.equal(app.ownerDocument.activeElement, app.hosts[to]);
    assertChoices(app, [0, 1, 2].map(i => i === to));
    assertTabs(app, [0, 1, 2].map(i => i === to ? 0 : -1));
  }
  assert.equal(app.key(0, "Tab"), false);
  assert.equal(app.key(0, " "), false);
  assert.deepEqual(app.writes, ["dark", "system", "light", "system"]);
});

test("Web arrows cannot write while pending and failed keyboard choice restores focus only inside the group", async () => {
  const restoring = harness({ ready: false });
  assertTabs(restoring, [-1, -1, -1]);
  restoring.key(0, "ArrowRight");
  assert.deepEqual(restoring.writes, []);
  let settle;
  const app = harness({ save: () => new Promise((resolve, reject) => {
    settle = success => success ? resolve() : reject(new Error("storage unavailable"));
  }) });
  app.hosts[0].focus();
  app.key(0, "ArrowRight");
  assertTabs(app, [-1, -1, -1]);
  app.key(1, "ArrowRight");
  assert.deepEqual(app.writes, ["light"]);
  settle(false);
  await flush();
  assert.equal(app.ownerDocument.activeElement, app.hosts[0]);
  assertTabs(app, [0, -1, -1]);
  app.key(0, "ArrowLeft");
  const outside = {};
  app.ownerDocument.activeElement = outside;
  settle(false);
  await flush();
  assert.equal(app.ownerDocument.activeElement, outside);
  assertChoices(app, [true, false, false]);
  assertTabs(app, [0, -1, -1]);
});
