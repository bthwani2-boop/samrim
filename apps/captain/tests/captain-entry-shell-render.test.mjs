import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const captain = path.join(root, "apps/captain");
const sources = ["src/features/access/captain-entry-shell", "src/components/captain-capability-screen",
  "src/features/dispatch/captain-home-screen", "app/(tabs)/account", "app/offers"];
const temporary = mkdtempSync(path.join(tmpdir(), "bthwani-captain-guest-navigation-"));
const compiled = new Map();
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), ...sources.map(source => path.join(captain, `${source}.tsx`)),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--rootDir", captain, "--outDir", temporary,
  ], { cwd: root, timeout: 20_000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const source of sources) compiled.set(source, readFileSync(path.join(temporary, `${source}.js`), "utf8"));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function renderable(source, dependencies = {}) {
  const module = { exports: {} };
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View", ScrollView: "ScrollView", Pressable: "Pressable" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { Link: "Link" },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    ...dependencies,
  };
  new Function("require", "module", "exports", compiled.get(source))(name => {
    assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports.default;
}
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("Captain compiled guest shell inherits direction and exposes four disabled tabs without navigation", () => {
  const rendered = renderable("src/features/access/captain-entry-shell")({
    color: "secondary-token", borderColor: "border-token", backgroundColor: "surface-token",
  });
  const all = nodes(rendered);
  assert.equal(rendered.props.testID, "captain-guest-shell");
  assert.equal(rendered.props.style.backgroundColor, "surface-token");
  const row = all.find(n => n.props?.style?.flexDirection === "row");
  assert.ok(row, "guest preview uses one row in the application direction");
  assert.equal(Object.hasOwn(row.props.style, "direction"), false);
  const tabs = all.filter(node => node.props?.testID?.startsWith("captain-guest-tab-"));
  assert.deepEqual(tabs.map(node => node.props.testID), [
    "captain-guest-tab-home", "captain-guest-tab-deliveries",
    "captain-guest-tab-wallet", "captain-guest-tab-account",
  ]);
  assert.deepEqual(tabs.map(node => node.props.accessibilityLabel), [
    "الرئيسية — غير متاح", "التوصيلات — غير متاح",
    "المحفظة — غير متاح", "حسابي — غير متاح",
  ]);
  for (const tab of tabs) {
    assert.equal(tab.props.accessibilityRole, "tab");
    assert.equal(tab.props.accessibilityState.disabled, true);
    assert.equal(tab.props.accessible, true);
    assert.ok(!Object.hasOwn(tab.props, "onPress"), "guest tab must not navigate");
    assert.ok(!Object.hasOwn(tab.props, "href"), "guest tab cannot open protected route");
  }
  assert.equal(all.some(node => typeof node.props?.onPress === "function"), false);
  assert.equal(all.some(node => node.props?.href), false);
});

test("Captain workspace separates verified access from unavailable data and keeps real return links", () => {
  const screen = renderable("src/components/captain-capability-screen");
  const screenModule = { __esModule: true, default: screen };
  let workspace = {
    session: { actorId: "synthetic-captain", role: "captain",
      sessionExpiresAt: "2099-11-22T19:10:00Z" },
    standing: { actorId: "synthetic-captain", status: "APPROVED", version: 3 },
  };
  const home = renderable("src/features/dispatch/captain-home-screen", {
    "../access/protected-route": { useCaptainWorkspace: () => workspace },
  });
  const offers = renderable("app/offers", {
    "../src/components/captain-capability-screen": screenModule,
    "../src/features/access/protected-route": { __esModule: true, default: "CaptainProtectedRoute" },
  });
  const dashboard = nodes(home());
  assert.ok(dashboard.some(node => node.props.testID === "captain-standing-verified" &&
    node.props.children.includes("3")));
  assert.ok(dashboard.some(node => node.props.children?.includes?.("مهام التوصيل")));
  assert.deepEqual(dashboard.filter(node => node.type === "Link"), []);
  workspace = null;
  assert.equal(home(), null, "private Home does not render outside verified workspace");
  const guardedOffers = offers();
  assert.equal(guardedOffers.type, "CaptainProtectedRoute");
  const offerLinks = nodes(screen(guardedOffers.props.children.props)).filter(node => node.type === "Link");
  assert.deepEqual(offerLinks.map(node => node.props.href), ["/home"]);
});

test("Captain account renders verified session and can request owner logout", () => {
  let workspace = null;
  let requested = false;
  const account = renderable("app/(tabs)/account", {
    "../../src/features/access/protected-route": { useCaptainWorkspace: () => workspace },
  });
  assert.equal(account(), null);
  workspace = {
    session: { actorId: "synthetic-captain", role: "captain", sessionExpiresAt: "2026-11-21T12:00:00Z" },
    signOut() { requested = true; },
  };
  const view = account();
  assert.equal(view.type, "SafeAreaView");
  assert.deepEqual(view.props.edges, ["top", "left", "right"]);
  const content = nodes(view);
  assert.ok(content.some(node => node.props.children === "حساب الكابتن معتمد"));
  assert.equal(content.some(node => node.props.testID === "captain-capability-unavailable"), false);
  content.find(node => node.type === "Pressable").props.onPress();
  assert.equal(requested, true);
});
