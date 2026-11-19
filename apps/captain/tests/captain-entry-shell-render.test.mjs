import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/access/captain-entry-shell.tsx", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "bthwani-captain-guest-navigation-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temporary,
  ], { cwd: root, timeout: 20_000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temporary, "captain-entry-shell.js"), "utf8");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  dependency => {
    if (dependency === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (dependency === "react-native") return { Text: "Text", View: "View" };
    throw new Error(`unexpected dependency ${dependency}`);
  }, module, module.exports,
);
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("Captain compiled guest shell inherits direction and exposes four disabled tabs without navigation", () => {
  const rendered = module.exports.default({
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
