import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/navigation/merchant-entry-shell.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-public-shell-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "merchant-entry-shell.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function renderShell(desktop) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const mock = {
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
      background: "#000", surface: "#111", color: "#fff", colorSecondary: "#ccc",
      interactiveText: "#fff", borderColor: "#444",
    } }) },
    "@bthwani/tamagui-config/navigation": { usePrimaryNavigation: () => ({ desktop }) },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ScrollView: "ScrollView", Text: "Text", View: "View" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./merchant-workspace-model": {
      merchantNavigation: [
        { id: "home", label: "الرئيسية" },
        { id: "stores", label: "المتاجر" },
        { id: "orders", label: "الطلبات" },
        { id: "products", label: "المنتجات" },
        { id: "wallet", label: "المحفظة" },
        { id: "more", label: "المزيد" },
      ],
      merchantMobileSections: ["home", "orders", "products", "wallet", "more"],
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => {
      assert.ok(Object.hasOwn(mock, name), `unexpected dependency ${name}`);
      return mock[name];
    }, mod, mod.exports,
  );
  return mod.exports.default({ children: jsx("LoginForm", { testID: "safe-identity-gate" }) });
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach(child => { walk(child, visit); });
    return;
  }
  if (node === null || typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}

for (const desktop of [false, true]) {
  test(`Guest Merchant shell exposes basic layout without protected access (desktop=${desktop})`, () => {
    const view = renderShell(desktop);
    const labels = [];
    const pressables = [];
    let loginFound = false;
    let lockedNoticeFound = false;
    let sideFound = false;
    let mobileFound = false;
    walk(view, node => {
      if (typeof node.props?.children === "string") labels.push(node.props.children);
      if (node.type === "Pressable") pressables.push(node);
      if (node.type === "LoginForm") loginFound = true;
      if (node.props?.testID === "merchant-guest-sidebar") sideFound = true;
      if (node.props?.testID === "merchant-guest-mobile-tabs") mobileFound = true;
      if (node.props?.testID === "merchant-guest-locked-notice") lockedNoticeFound = true;
    });
    assert.equal(loginFound, true, "existing Identity form remains usable");
    assert.equal(lockedNoticeFound, true, "guest area explicitly says authorization is required");
    assert.equal(sideFound, desktop);
    assert.equal(mobileFound, !desktop);
    const selectedLabels = desktop
      ? ["الرئيسية", "المتاجر", "الطلبات", "المنتجات", "المحفظة", "المزيد"]
      : ["الرئيسية", "الطلبات", "المنتجات", "المحفظة", "المزيد"];
    for (const name of selectedLabels) assert.ok(labels.includes(name), name);
    assert.deepEqual(pressables, [], "guest navigation must never offer protected clickable actions");
  });
}
