import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const source = fileURLToPath(new URL("./account-preferences.tsx", import.meta.url));

function harness({ ready = true, save = async () => {} } = {}) {
  const temp = mkdtempSync(path.join(tmpdir(), "customer-account-preferences-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp,
    ], { cwd: root, encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsx = (type, props) => ({ type, props });
    let preference = "system", slot = 0;
    const states = [], writes = [];
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
      "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
      "@bthwani/tamagui-config/appearance": {
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
    const mod = loadMappedRenderFixture(readFileSync(path.join(temp, "account-preferences.js"), "utf8"), source, mocks);
    const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ?
      tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
    const render = () => { slot = 0; return nodes(mod.exports.default()); };
    return { writes, render, radios: () => render().filter(n => n.props?.accessibilityRole === "radio") };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

const labels = ["\u0627\u0644\u0646\u0638\u0627\u0645", "\u0641\u0627\u062a\u062d", "\u062f\u0627\u0643\u0646"];
const flush = () => new Promise(resolve => setImmediate(resolve));
function assertChoices(app, expected) {
  const radios = app.radios();
  assert.deepEqual(radios.map(r => r.props.accessibilityLabel), labels);
  assert.deepEqual(radios.map(r => r.props["aria-checked"]), expected);
  assert.deepEqual(radios.map(r => r.props.accessibilityState.checked), expected);
}

test("Customer appearance exposes named radios with one Web and native checked choice", async () => {
  const app = harness();
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
});

test("Customer appearance disables writes while restoring or saving and recovers from rejection", async () => {
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
