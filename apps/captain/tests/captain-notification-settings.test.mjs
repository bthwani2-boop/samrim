import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const captain = path.resolve(import.meta.dirname, "..");
const root = path.resolve(captain, "../..");
const feature = "src/features/notifications/device-notification-settings";
const home = "app/(tabs)/home";
const homeScreen = "src/features/dispatch/captain-home-screen";
const route = "app/notifications";
const screen = "src/components/captain-capability-screen";
const sources = [home, homeScreen, route, screen, feature].filter(name => existsSync(path.join(captain, name + ".tsx")));
const temp = mkdtempSync(path.join(tmpdir(), "captain-notification-settings-"));
const compiled = new Map();
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    ...sources.map(name => path.join(captain, name + ".tsx")),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--rootDir", captain, "--outDir", temp],
    { cwd: root, timeout: 20000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const name of sources) compiled.set(name, readFileSync(path.join(temp, name + ".js"), "utf8"));
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
  "expo-router": { Link: "Link" },
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
};
function load(name, mocks = {}) {
  assert.ok(compiled.has(name), "missing implemented component: " + name);
  return loadMappedRenderFixture(compiled.get(name), path.join(captain, name + ".tsx"), { ...base, ...mocks }).exports.default;
}

test("verified Home exposes notification settings; foreign standing cannot show the link", () => {
  const session = { actorId: "captain-a", sessionExpiresAt: "2099-01-01T00:00:00Z" };
  let workspace = { session, standing: { actorId: session.actorId, status: "APPROVED", version: 1 } };
  const Home = load(homeScreen, { "../access/protected-route": { useCaptainWorkspace: () => workspace } });
  const HomeRoute = load(home, {
    "../../src/features/dispatch/captain-home-screen": { __esModule: true, default: Home },
    "../../src/features/location/device-location-readiness": { __esModule: true, default: "DeviceLocation" },
  });
  const tree = HomeRoute();
  assert.equal(tree.type, Home);
  assert.ok(nodes(Home(tree.props)).some(n => n.props.href === "/notifications"));
  workspace = { ...workspace, standing: { actorId: "other", status: "APPROVED", version: 1 } };
  assert.ok(!nodes(Home(tree.props)).some(n => n.props.href === "/notifications"));
  workspace = null;
  assert.equal(Home(tree.props), null);
});

test("protected notifications route contains device settings and truthful unavailable owner inbox", () => {
  const Screen = load(screen);
  const Route = load(route, {
    "../src/components/captain-capability-screen": { __esModule: true, default: Screen },
    "../src/features/access/protected-route": { __esModule: true, default: "Protected" },
    "../src/features/notifications/device-notification-settings": { __esModule: true, default: "DeviceSettings" },
  });
  const tree = Route();
  assert.equal(tree.type, "Protected");
  assert.equal(tree.props.children.type, Screen);
  const rendered = Screen(tree.props.children.props);
  assert.ok(nodes(rendered).some(n => n.type === "DeviceSettings"));
  assert.ok(find(rendered, "captain-capability-unavailable"));
  assert.ok(nodes(rendered).some(n => n.props.href === "/home"));
});

function harness({ platform = "android", initial = "active", permission = { granted: false } } = {}) {
  const state = [];
  const refs = [];
  let index = 0, refIndex = 0, focus, cleanup, listener, currentState = initial;
  let readPermission = async () => permission, openSettings = async () => {};
  const calls = { reads: 0, opens: 0, removed: 0 };
  const Component = load(feature, {
    react: {
      useState(value) { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = next; }]; },
      useRef(value) { const i = refIndex++; refs[i] ??= { current: value }; return refs[i]; },
      useCallback(callback) { return callback; },
    },
    "expo-router": { useFocusEffect(callback) { focus = callback; } },
    "react-native": { ...base["react-native"], Platform: { OS: platform },
      AppState: { get currentState() { return currentState; }, addEventListener(event, callback) {
        assert.equal(event, "change"); listener = callback;
        return { remove() { calls.removed++; listener = undefined; } };
      } }, Linking: { openSettings() { calls.opens++; return openSettings(); } } },
    "expo-notifications": {
      IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
      getPermissionsAsync() { calls.reads++; return readPermission(); },
    },
  });
  return { calls, render() { index = 0; refIndex = 0; return Component(); },
    focus() { cleanup?.(); cleanup = focus(); }, blur() { cleanup?.(); cleanup = undefined; },
    state(value) { currentState = value; listener?.(value); },
    setPermission(value) { permission = value; },
    read(value) { readPermission = value; }, open(value) { openSettings = value; } };
}
test("native foreground reads permission without auto prompt; settings action is explicit and single flight", async () => {
  const h = harness(); h.render(); assert.equal(h.calls.reads, 0); h.focus(); await settle();
  assert.equal(h.calls.reads, 1); assert.equal(h.calls.opens, 0);
  assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات غير ممنوح");
  let finish;
  h.open(() => new Promise(resolve => { finish = resolve; }));
  const press = find(h.render(), "captain-notifications-settings").props.onPress;
  press(); press(); assert.equal(h.calls.opens, 1);
  assert.equal(find(h.render(), "captain-notifications-settings"), undefined);
  h.state("background"); h.setPermission({ granted: true }); h.state("active"); await settle();
  assert.equal(h.calls.reads, 1, "no permission read during settings launch");
  assert.equal(find(h.render(), "captain-notifications-permission"), undefined);
  finish(); await settle();
  assert.equal(h.calls.reads, 2);
  assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات ممنوح");
  h.blur(); press(); assert.equal(h.calls.opens, 1); assert.equal(h.calls.removed, 1);
});
test("unknown initial states and Web never read native permissions before activation", async () => {
  for (const initial of [null, "unknown", "extension", "inactive", "background"]) {
    const h = harness({ initial }); h.render(); h.focus(); await settle();
    assert.equal(h.calls.reads, 0); assert.equal(find(h.render(), "captain-notifications-settings"), undefined);
    h.state("active"); await settle(); assert.equal(h.calls.reads, 1); h.blur();
  }
  const web = harness({ platform: "web" }); web.render(); web.focus(); await settle();
  assert.equal(web.calls.reads, 0); assert.equal(web.calls.opens, 0);
  assert.equal(find(web.render(), "captain-notifications-settings"), undefined);
});
test("provisional and ephemeral iOS permission is not advertised as unrestricted delivery", async () => {
  for (const status of [3, 4]) {
    const h = harness({ platform: "ios", permission: { granted: true, ios: { status } } });
    h.render(); h.focus(); await settle();
    assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات محدود");
    h.blur();
  }
});
test("delayed previous focus and background reads cannot overwrite fresh device state", async () => {
  const h = harness(); let finish;
  h.read(() => new Promise(resolve => { finish = resolve; }));
  h.render(); h.focus();
  h.state("background");
  h.read(async () => ({ granted: false })); h.state("active"); await settle();
  finish({ granted: true }); await settle();
  assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات غير ممنوح");
  h.blur();
});
test("failed native read and failed settings launch expose real recovery, never false permission", async () => {
  const h = harness(); h.read(async () => { throw Error("read"); });
  h.render(); h.focus(); await settle();
  assert.ok(find(h.render(), "captain-notifications-read-error"));
  h.open(async () => { throw Error("open"); });
  find(h.render(), "captain-notifications-settings").props.onPress();
  await settle();
  assert.ok(find(h.render(), "captain-notifications-settings-error"));
  h.read(async () => ({ granted: true }));
  find(h.render(), "captain-notifications-refresh").props.onPress(); await settle();
  assert.ok(!find(h.render(), "captain-notifications-settings-error"));
  assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات ممنوح");
  h.blur();
});
test("settings completion rereads only the current focus and duplicate foreground signals do not start extra reads", async () => {
  const h = harness(); h.render(); h.focus(); await settle();
  h.state("active"); await settle(); assert.equal(h.calls.reads, 1);
  let reject;
  h.open(() => new Promise((_resolve, fail) => { reject = fail; }));
  const stale = find(h.render(), "captain-notifications-settings").props.onPress;
  stale(); h.blur(); h.render(); h.focus(); await settle();
  assert.equal(h.calls.reads, 1);
  h.setPermission({ granted: true }); reject(Error("old launch")); await settle();
  assert.equal(h.calls.reads, 2);
  assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات ممنوح");
  assert.equal(find(h.render(), "captain-notifications-settings-error"), undefined);
  stale(); assert.equal(h.calls.opens, 1);
  h.blur();
});
test("settings success while still active rereads device instead of retaining pre-launch permission", async () => {
  const h = harness(); h.render(); h.focus(); await settle();
  h.open(async () => { h.setPermission({ granted: true }); });
  find(h.render(), "captain-notifications-settings").props.onPress();
  await settle();
  assert.equal(h.calls.reads, 2);
  assert.equal(find(h.render(), "captain-notifications-permission").props.children, "إذن الإشعارات ممنوح");
  h.blur();
});
