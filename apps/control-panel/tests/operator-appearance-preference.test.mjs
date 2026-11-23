import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const source = readFileSync(resolve(import.meta.dirname, "../app/providers.tsx"), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const jsx = (type, props) => ({ type, props: props ?? {} });

function harness() {
  const effects = [];
  const reads = [];
  const writes = [];
  const storage = new Map();
  const context = { Provider: "PreferenceProvider" };
  const modules = {
    "@bthwani/design-system/theme": { themes: {
      light: { actionBackground: "#abc", color: "#000", background: "#fff", borderColor: "#ddd" },
      dark: { actionBackground: "#123", color: "#fff", background: "#000", borderColor: "#999" },
    } },
    antd: { theme: { darkAlgorithm: "dark", defaultAlgorithm: "light" },
      ConfigProvider: "ConfigProvider", Segmented: "Segmented" },
    "antd/locale/ar_EG": { default: {} },
    react: {
      createContext: () => context,
      useContext: () => null,
      useEffect: effect => { effects.push(effect); },
      useState: initial => [initial, () => {}],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
    return modules[name];
  }, mod, mod.exports);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    localStorage: {
      getItem(key) { reads.push(key); return storage.get(key) ?? null; },
      setItem(key, value) { writes.push([key, value]); storage.set(key, value); },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.document = { documentElement: { dataset: {} } };
  return {
    storage, reads, writes,
    render(operatorActorId) {
      effects.length = 0;
      const tree = mod.exports.Providers({ children: jsx("main", {}), cspNonce: "nonce", operatorActorId });
      const preferenceContext = tree.props.children;
      for (const effect of effects) effect();
      return preferenceContext.props.value;
    },
    cleanup() {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
  };
}

test("Operator appearance preferences are persisted per verified actor and never on sign-out", () => {
  const ui = harness();
  try {
    ui.render("operator-one").onChange("dark");
    ui.render("operator-two").onChange("light");
    ui.render(null).onChange("dark");
    assert.deepEqual(ui.reads, [
      "bthwani.stage4.operator.theme:operator-one",
      "bthwani.stage4.operator.theme:operator-two",
    ]);
    assert.deepEqual(ui.writes, [
      ["bthwani.stage4.operator.theme:operator-one", "dark"],
      ["bthwani.stage4.operator.theme:operator-two", "light"],
    ]);
  } finally {
    ui.cleanup();
  }
});
