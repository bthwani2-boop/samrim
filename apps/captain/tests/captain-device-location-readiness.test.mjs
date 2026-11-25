import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const captain = path.resolve(import.meta.dirname, "..");
const root = path.resolve(captain, "../..");
const location = "src/features/location/device-location-readiness";
const home = "src/features/dispatch/captain-home-screen";
const route = "app/(tabs)/home";
const sources = [location, home, route].filter(name => existsSync(path.join(captain, name + ".tsx")));
const temp = mkdtempSync(path.join(tmpdir(), "captain-device-readiness-"));
const compiled = new Map();
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    ...sources.map(name => path.join(captain, name + ".tsx")),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--rootDir", captain, "--outDir", temp],
    { cwd: root, timeout: 20000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const name of sources) {
    const entry = path.join(captain, name + ".tsx");
    const code = readFileSync(path.join(temp, name + ".js"), "utf8").replace(
      /(\/\/# sourceMappingURL=data:application\/json;base64,)([A-Za-z0-9+/=]+)/,
      (_, prefix, data) => {
        const map = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
        map.sourceRoot = "";
        map.sources = [path.basename(entry)];
        return prefix + Buffer.from(JSON.stringify(map)).toString("base64");
      });
    compiled.set(name, code);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }

const jsx = (type, props) => ({ type, props: props ?? {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object"
  ? [tree, ...nodes(tree.props?.children)] : [];
const find = (tree, id) => nodes(tree).find(node => node.props.testID === id);
const settle = () => new Promise(resolve => setImmediate(resolve));
const base = {
  "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
  "react-native": { ScrollView: "ScrollView", Text: "Text", View: "View", Pressable: "Pressable" },
  "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
};
function load(name, dependencies) {
  assert.ok(compiled.has(name), "native device readiness component is missing");
  const modules = { ...base, ...dependencies };
  const filename = path.join(captain, name + ".tsx.compiled.cjs");
  const mod = new Module(filename);
  mod.require = id => { assert.ok(Object.hasOwn(modules, id), id); return modules[id]; };
  mod._compile(compiled.get(name), filename);
  return mod.exports.default;
}
function harness({ platform = "android", initial = "active", permission = { granted: false, canAskAgain: true },
  services = false } = {}) {
  const hooks = [];
  let index = 0, focus, cleanup, listener, currentState = initial;
  let readPermission = async () => permission, readServices = async () => services;
  let request = async () => { permission = { granted: true, canAskAgain: true }; return permission; };
  const calls = { permissions: 0, services: 0, requests: 0, removed: 0 };
  const component = load(location, {
    react: {
      useState(value) { const i = index++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], next => { hooks[i] = next; }]; },
      useRef(value) { const i = index++; hooks[i] ??= { current: value }; return hooks[i]; },
      useCallback(callback) { index++; return callback; },
    },
    "expo-router": { useFocusEffect(callback) { focus = callback; } },
    "react-native": { ...base["react-native"], Platform: { OS: platform },
      AppState: { get currentState() { return currentState; }, addEventListener(event, callback) {
        assert.equal(event, "change"); listener = callback;
        return { remove() { calls.removed++; listener = undefined; } };
      } } },
    "expo-location": {
      getForegroundPermissionsAsync() { calls.permissions++; return readPermission(); },
      hasServicesEnabledAsync() { calls.services++; return readServices(); },
      requestForegroundPermissionsAsync() { calls.requests++; return request(); },
    },
  });
  return { calls, render() { index = 0; return component(); },
    focus() { cleanup?.(); cleanup = focus(); },
    blur() { cleanup?.(); cleanup = undefined; },
    state(value) { currentState = value; listener?.(value); },
    setPermission(value) { permission = value; }, setServices(value) { services = value; },
    readPermission(value) { readPermission = value; }, readServices(value) { readServices = value; },
    request(value) { request = value; }, get listener() { return listener; } };
}
test("real Home route mounts the device readiness only for the verified Captain", () => {
  const session = { actorId: "captain-a", role: "captain", sessionExpiresAt: "2099-01-01T00:00:00Z" };
  let workspace = { session, standing: { actorId: session.actorId, status: "APPROVED", version: 1 } };
  const Home = load(home, { "../access/protected-route": { useCaptainWorkspace: () => workspace } });
  const Route = load(route, { "../../src/features/dispatch/captain-home-screen": { __esModule: true, default: Home },
    "../../src/features/location/device-location-readiness": { __esModule: true, default: "DeviceReadiness" } });
  const tree = Route();
  assert.equal(tree.type, Home);
  assert.ok(nodes(Home(tree.props)).some(n => n.type === "DeviceReadiness"));
  workspace = { ...workspace, standing: { actorId: "foreign", status: "APPROVED", version: 1 } };
  assert.ok(!nodes(Home(tree.props)).some(n => n.type === "DeviceReadiness"));
  workspace = null;
  assert.equal(Home(tree.props), null);
});
test("focus reads real device status without prompting; explicit consent is single flight", async () => {
  const h = harness(); h.render(); assert.equal(h.calls.permissions, 0); h.focus(); await settle();
  assert.deepEqual([h.calls.permissions, h.calls.services, h.calls.requests], [1, 1, 0]);
  const first = h.render();
  assert.ok(find(first, "captain-location-permission")); assert.ok(find(first, "captain-location-services"));
  const stale = find(first, "captain-location-request").props.onPress;
  let resolve; h.request(() => new Promise(done => { resolve = done; }));
  stale(); stale(); assert.equal(h.calls.requests, 1);
  assert.equal(find(h.render(), "captain-location-request"), undefined);
  h.setPermission({ granted: true, canAskAgain: true }); h.setServices(true); resolve(); await settle();
  assert.equal(h.calls.permissions, 2); assert.equal(h.calls.services, 2);
  assert.equal(find(h.render(), "captain-location-request"), undefined);
  stale(); assert.equal(h.calls.requests, 1); h.blur(); assert.equal(h.calls.removed, 1);
});
test("permanent denial does not prompt, manual refresh reads changed device settings", async () => {
  const h = harness({ permission: { granted: false, canAskAgain: false } }); h.render(); h.focus(); await settle();
  assert.equal(find(h.render(), "captain-location-request"), undefined);
  h.setPermission({ granted: true, canAskAgain: true }); h.setServices(true);
  const stale = find(h.render(), "captain-location-refresh").props.onPress;
  stale(); stale(); await settle(); assert.equal(h.calls.permissions, 2); assert.equal(h.calls.requests, 0); h.blur();
});
test("background and new focus invalidate delayed readings and stale actions", async () => {
  const h = harness(); h.render(); h.focus(); await settle();
  const stale = find(h.render(), "captain-location-request").props.onPress;
  let resolve; h.readPermission(() => new Promise(done => { resolve = done; }));
  find(h.render(), "captain-location-refresh").props.onPress();
  h.state("background"); stale(); assert.equal(h.calls.requests, 0);
  assert.equal(find(h.render(), "captain-location-permission"), undefined);
  h.readPermission(async () => ({ granted: true, canAskAgain: true })); h.setServices(true);
  h.state("active"); await settle(); resolve({ granted: false, canAskAgain: true }); await settle();
  assert.equal(find(h.render(), "captain-location-request"), undefined);
  const listener = h.listener; h.blur(); listener("active"); assert.equal(h.calls.permissions, 3);
});
test("initial background waits for active state and web never calls native permissions", async () => {
  const native = harness({ initial: "background" }); native.render(); native.focus(); assert.equal(native.calls.permissions, 0);
  native.state("active"); await settle(); assert.equal(native.calls.permissions, 1); native.blur();
  const web = harness({ platform: "web" }); web.render(); web.focus(); await settle();
  assert.equal(web.calls.permissions, 0); assert.equal(web.calls.requests, 0);
  assert.equal(find(web.render(), "captain-location-request"), undefined);
  assert.equal(find(web.render(), "captain-location-refresh"), undefined); web.blur();
});
test("read and permission errors are recoverable without granting fake permission", async () => {
  const h = harness(); h.readServices(async () => { throw Error("services unavailable"); });
  h.render(); h.focus(); await settle(); assert.ok(nodes(h.render()).some(n => n.props.accessibilityRole === "alert"));
  h.readServices(async () => false); find(h.render(), "captain-location-refresh").props.onPress(); await settle();
  h.request(async () => { throw Error("permission failure"); });
  find(h.render(), "captain-location-request").props.onPress(); await settle();
  assert.ok(nodes(h.render()).some(n => n.props.accessibilityRole === "alert"));
  find(h.render(), "captain-location-refresh").props.onPress(); await settle();
  assert.ok(find(h.render(), "captain-location-request")); h.blur();
});
test("an OS dialog interrupted by background is re-read, never interpreted as approval", async () => {
  const h = harness(); h.render(); h.focus(); await settle();
  let resolve; h.request(() => new Promise(done => { resolve = done; }));
  find(h.render(), "captain-location-request").props.onPress(); h.state("inactive"); h.state("active"); await settle();
  find(h.render(), "captain-location-request").props.onPress(); assert.equal(h.calls.requests, 1);
  h.setPermission({ granted: true, canAskAgain: true }); resolve({ granted: false }); await settle();
  assert.equal(find(h.render(), "captain-location-request"), undefined); h.blur();
});
test("late failed or successful permission request after blur cannot change the next view", async () => {
  for (const reject of [false, true]) {
    const h = harness(); h.render(); h.focus(); await settle();
    let finish; h.request(() => new Promise((resolve, fail) => { finish = reject ? () => fail(Error("late")) : resolve; }));
    find(h.render(), "captain-location-request").props.onPress(); h.blur();
    h.render(); h.focus(); await settle(); finish(); await settle();
    assert.ok(find(h.render(), "captain-location-request")); assert.equal(nodes(h.render()).some(n => n.props.accessibilityRole === "alert"), false);
    h.blur();
  }
});


test("successful dialog refreshes a newer focus scope using current OS facts", async () => {
  const h = harness(); h.render(); h.focus(); await settle();
  let finish; h.request(() => new Promise(resolve => { finish = resolve; }));
  find(h.render(), "captain-location-request").props.onPress(); h.blur();
  h.render(); h.focus(); await settle();
  assert.ok(find(h.render(), "captain-location-request"));
  h.setPermission({ granted: true, canAskAgain: true }); h.setServices(true);
  finish({ granted: false }); await settle();
  assert.equal(h.calls.permissions, 3, "fresh active scope must re-read OS permission");
  assert.equal(h.calls.services, 3);
  assert.equal(find(h.render(), "captain-location-request"), undefined);
  assert.equal(h.calls.requests, 1);
  h.blur();
});
test("a successful dialog does not read device settings while no scope is active", async () => {
  for (const inactive of ["blurred", "background"]) {
    const h = harness(); h.render(); h.focus(); await settle();
    let finish; h.request(() => new Promise(resolve => { finish = resolve; }));
    find(h.render(), "captain-location-request").props.onPress();
    if (inactive === "blurred") h.blur(); else h.state("background");
    const before = h.calls.permissions;
    h.setPermission({ granted: true, canAskAgain: true }); finish({ granted: true }); await settle();
    assert.equal(h.calls.permissions, before);
    if (inactive === "blurred") { h.render(); h.focus(); } else h.state("active");
    await settle();
    assert.equal(h.calls.permissions, before + 1);
    assert.equal(find(h.render(), "captain-location-request"), undefined);
    h.blur();
  }
});

test("initial non-active states never read device settings before foreground activation", async () => {
  for (const initial of [null, "unknown", "extension", "inactive", "background"]) {
    const h = harness({ initial });
    h.render(); h.focus(); await settle();
    assert.equal(h.calls.permissions, 0, `unexpected read for ${initial}`);
    assert.equal(h.calls.services, 0);
    assert.equal(h.calls.requests, 0);
    assert.equal(find(h.render(), "captain-location-request"), undefined);
    h.state("active"); await settle();
    assert.equal(h.calls.permissions, 1);
    assert.equal(h.calls.services, 1);
    assert.equal(h.calls.requests, 0);
    assert.ok(find(h.render(), "captain-location-request"));
    h.blur();
  }
});
