import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("Merchant settings select the existing appearance preference and recover from a failed save", async () => {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const source = fileURLToPath(new URL("./account-screen.tsx", import.meta.url));
  const temp = mkdtempSync(path.join(tmpdir(), "merchant-account-settings-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
    ], { cwd: root, encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsx = (type, props, key) => ({ type, props, key });
    const values = [], calls = [];
    let index = 0, preference = "system", ready = false, settle;
    const mocks = {
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      react: {
        useState(initial) {
          const i = index++;
          if (!(i in values)) values[i] = initial;
          return [values[i], next => { values[i] = next; }];
        },
        useRef(initial) {
          const i = index++;
          if (!(i in values)) values[i] = { current: initial };
          return values[i];
        },
      },
      "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
      "@bthwani/tamagui-config/appearance": {
        useMobileAppearance: () => ({
          preference, ready, theme: {},
          setPreference(next) {
            calls.push(next);
            return new Promise((resolve, reject) => {
              settle = success => {
                if (success) { preference = next; resolve(); }
                else reject(new Error("storage unavailable"));
              };
            });
          },
        }),
      },
      "../../components/merchant-capability-screen": { __esModule: true, default: "Placeholder" },
    };
    const mod = { exports: {} };
    new Function("require", "module", "exports", readFileSync(path.join(temp, "account-screen.js"), "utf8"))(
      name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, mod, mod.exports,
    );
    const Account = mod.exports.default;
    const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ?
      tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
    const render = () => { index = 0; return nodes(Account()); };
    const radios = () => render().filter(n => n.props?.accessibilityRole === "radio");
    assert.equal(radios().length, 3);
    assert.ok(radios().every(n => n.props.disabled));
    radios().find(n => n.props.accessibilityLabel === "داكن").props.onPress();
    assert.deepEqual(calls, []);
    ready = true;
    assert.equal(radios().find(n => n.props.accessibilityLabel === "حسب النظام").props.accessibilityState.checked, true);
    const dark = radios().find(n => n.props.accessibilityLabel === "داكن");
    const first = dark.props.onPress();
    assert.ok(radios().every(n => n.props.disabled));
    dark.props.onPress();
    assert.deepEqual(calls, ["dark"]);
    settle(false);
    await first;
    assert.ok(render().some(n => n.props?.accessibilityRole === "alert"));
    assert.ok(radios().every(n => !n.props.disabled));
    const retry = radios().find(n => n.props.accessibilityLabel === "داكن").props.onPress();
    settle(true);
    await retry;
    assert.deepEqual(calls, ["dark", "dark"]);
    assert.equal(radios().find(n => n.props.accessibilityLabel === "داكن").props.accessibilityState.checked, true);
    assert.ok(!render().some(n => n.props?.accessibilityRole === "alert"));
    for (const [label, value] of [["فاتح", "light"], ["حسب النظام", "system"]]) {
      const save = radios().find(n => n.props.accessibilityLabel === label).props.onPress();
      settle(true);
      await save;
      assert.equal(calls.at(-1), value);
      assert.equal(radios().find(n => n.props.accessibilityLabel === label).props.accessibilityState.checked, true);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
