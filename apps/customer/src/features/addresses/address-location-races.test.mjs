import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../../../..");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-address-races-"));
let compiled;
try {
  const task = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(import.meta.dirname, "address-editor.native.tsx"), "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(task.status, 0, task.stderr || task.stdout);
  compiled = readFileSync(path.join(temp, "address-editor.native.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function harness() {
  const hooks = [];
  const effects = [];
  const calls = { services: [], permissions: [], positions: [] };
  const movements = [];
  let index = 0;
  let writesAfterUnmount = 0;
  let mounted = true;
  const pending = key => new Promise((resolve, reject) => { calls[key].push({ resolve, reject }); });
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], next => { if (!mounted) writesAfterUnmount++; hooks[at] = next; }];
      },
      useRef(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = { current: initial };
        return hooks[at];
      },
      useEffect(fn) { const at = index++; if (!(at in hooks)) effects.push(() => { hooks[at] = { cleanup: fn() }; }); },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "Loading", Platform: { OS: "android" }, Pressable: "Button", SafeAreaView: "Safe", Text: "Text", View: "View" },
    "react-native-maps": { default: "Map", Marker: "Marker", PROVIDER_GOOGLE: "google" },
    "expo-location": { Accuracy: { Balanced: "balanced" }, hasServicesEnabledAsync: () => pending("services"),
      requestForegroundPermissionsAsync: () => pending("permissions"), getCurrentPositionAsync: () => pending("positions") },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`);
    return modules[name];
  }, mod, mod.exports);
  return {
    calls, movements,
    render() {
      index = 0;
      effects.length = 0;
      const view = mod.exports.default();
      effects.forEach(fn => { fn(); });
      byID(view, "address-location-map").props.ref.current = { animateToRegion: (...args) => movements.push(args) };
      return view;
    },
    unmount() { hooks.forEach(hook => { hook?.cleanup?.(); }); mounted = false; },
    writesAfterUnmount: () => writesAfterUnmount,
  };
}
function byID(node, id) {
  if (Array.isArray(node)) return node.map(child => byID(child, id)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return node.props?.testID === id ? node : byID(node.props?.children, id);
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  return typeof node === "object" ? content(node.props?.children) : String(node);
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const choose = (view, coordinate = { latitude: 15.4, longitude: 44.2 }) =>
  byID(view, "address-location-map").props.onPress({ nativeEvent: { coordinate } });
const locate = view => byID(view, "address-location-request").props.onPress();
async function allow(h) {
  h.calls.services.at(-1).resolve(true); await settle();
  h.calls.permissions.at(-1).resolve({ status: "granted" }); await settle();
}

test("a manual pin wins over a late successful GPS response", async () => {
  const h = harness(); locate(h.render()); await allow(h);
  choose(h.render());
  h.calls.positions[0].resolve({ coords: { latitude: 12, longitude: 45 } }); await settle();
  assert.match(content(byID(h.render(), "address-location-coordinate")), /15.40000, 44.20000/);
  assert.equal(h.movements.length, 0);
  assert.equal(byID(h.render(), "address-location-request").props.disabled, false);
});
test("late GPS failure cannot replace the manual choice with an error", async () => {
  const h = harness(); locate(h.render()); await allow(h); choose(h.render());
  h.calls.positions[0].reject(new Error("unavailable")); await settle();
  assert.equal(byID(h.render(), "address-location-error"), undefined);
});
test("manual selection before service response suppresses the obsolete permission prompt", async () => {
  const h = harness(); locate(h.render()); choose(h.render());
  h.calls.services[0].resolve(true); await settle();
  assert.equal(h.calls.permissions.length, 0);
});
test("repeated taps before a render start only one permission flow", () => {
  const h = harness(); const view = h.render(); locate(view); locate(view);
  assert.equal(h.calls.services.length, 1);
});
test("a superseded request cannot clear the busy state of an explicit new request", async () => {
  const h = harness(); locate(h.render()); await allow(h); choose(h.render());
  locate(h.render());
  h.calls.positions[0].reject(new Error("old")); await settle();
  assert.equal(byID(h.render(), "address-location-request").props.disabled, true);
  assert.equal(byID(h.render(), "address-location-error"), undefined);
  await allow(h);
  h.calls.positions[1].resolve({ coords: { latitude: 13, longitude: 46 } }); await settle();
  assert.match(content(byID(h.render(), "address-location-coordinate")), /13.00000, 46.00000/);
  assert.equal(h.movements.length, 1);
});
for (const stage of ["services", "permissions", "positions"]) {
  test(`unmount while waiting for ${stage} performs no later UI writes or prompts`, async () => {
    const h = harness(); locate(h.render());
    if (stage !== "services") { h.calls.services[0].resolve(true); await settle(); }
    if (stage === "positions") { h.calls.permissions[0].resolve({ status: "granted" }); await settle(); }
    h.unmount();
    h.calls[stage][0].resolve(stage === "services" ? true : stage === "permissions" ? { status: "granted" } : { coords: { latitude: 14, longitude: 45 } });
    await settle();
    assert.equal(h.writesAfterUnmount(), 0);
    assert.equal(h.movements.length, 0);
    if (stage === "services") assert.equal(h.calls.permissions.length, 0);
    if (stage === "permissions") assert.equal(h.calls.positions.length, 0);
  });
}
test("current invalid GPS and denied permission remain recoverable", async () => {
  const h = harness(); locate(h.render()); await allow(h);
  h.calls.positions[0].resolve({ coords: { latitude: NaN, longitude: 45 } }); await settle();
  assert.match(content(byID(h.render(), "address-location-error")), /صالح/);
  locate(h.render()); h.calls.services[1].resolve(true); await settle();
  h.calls.permissions[1].resolve({ status: "denied" }); await settle();
  assert.match(content(byID(h.render(), "address-location-error")), /إذن/);
  choose(h.render());
  assert.equal(byID(h.render(), "address-location-error"), undefined);
});
