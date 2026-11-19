import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../app/(tabs)/_layout.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-sidebar-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "_layout.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function render(desktop) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const tabs = () => null;
  tabs.Screen = "TabScreen";
  const mocks = {
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
      surface: "#111", borderColor: "#444", color: "#fff",
      colorSecondary: "#ddd", actionSoft: "#222", interactiveText: "#fff",
    } }) },
    "@bthwani/tamagui-config/navigation": { usePrimaryNavigation: () => ({
      desktop, screenOptions: { tabBarPosition: "bottom", tabBarVariant: "uikit" },
    }) },
    "expo-router": { Link: "Link", Tabs: tabs },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View" },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    }, mod, mod.exports,
  );
  return mod.exports.default();
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach(child => { walk(child, visit); });
    return;
  }
  if (!node || typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}

test("wide Customer Web renders a right-side public sidebar without inventing authorizations", () => {
  const layout = render(true);
  assert.equal(layout.props.screenOptions.tabBarPosition, "left");
  assert.equal(typeof layout.props.tabBar, "function");
  const preview = layout.props.tabBar({ state: { index: 0, routes: [{ name: "index" }] } });
  const sidebar = preview.type(preview.props);
  const links = [];
  let nav;
  walk(sidebar, node => {
    if (node.type === "Link") links.push([node.props.href, node.props.children, node.props["aria-current"]]);
    if (node.props?.accessibilityRole === "navigation") nav = node;
  });
  assert.equal(nav.props.accessibilityLabel, "تنقل بثواني");
  for (const url of ["/", "/orders", "/account", "/stores"]) {
    assert.ok(links.some(([href]) => href === url), `missing public shell entry: ${url}`);
  }
  assert.ok(links.some(([href, , current]) => href === "/" && current === "page"));
  assert.equal(links.some(([href]) => href === "/wallet"), false,
    "private financial actions must not appear as public Customer links");
});

test("Customer Android retains three established bottom tabs and URLs", () => {
  const layout = render(false);
  assert.equal(layout.props.tabBar, undefined);
  assert.equal(layout.props.screenOptions.tabBarPosition, "bottom");
  const names = layout.props.children.map(route => route.props.name);
  assert.deepEqual(names, ["index", "orders/index", "account/index"]);
});
