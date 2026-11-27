import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const source = fileURLToPath(new URL("../app/(tabs)/account.tsx", import.meta.url));
const session = { actorId: "captain-17", role: "captain", sessionExpiresAt: "2099-11-22T19:10:00Z" };
const standing = { actorId: session.actorId, status: "APPROVED", version: 17 };
const theme = { background: "bg", surface: "surface", borderColor: "border", color: "text",
  colorSecondary: "muted", successText: "success", warningText: "warning", dangerText: "danger" };

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function render(workspace) {
  const tmp = mkdtempSync(path.join(tmpdir(), "captain-account-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), source, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsx = (type, props) => ({ type, props: props ?? {} });
    const mocks = {
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme }) },
      "@bthwani/tamagui-config/appearance-preferences": { __esModule: true, default: "AppearancePreferences" },
      "react-native": { ScrollView: "ScrollView", Text: "Text", View: "View", Pressable: "Pressable" },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "../../src/features/access/protected-route": { useCaptainWorkspace: () => workspace },
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    };
    return loadMappedRenderFixture(readFileSync(path.join(tmp, "account.js"), "utf8"), source, mocks).exports.default();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const hasText = (tree, value) => nodes(tree).some(n => typeof n.props?.children === "string" && n.props.children.includes(value));

test("Captain account delegates appearance to the shared control only within a verified workspace", () => {
  assert.equal(render(null), null);
  let signedOut = 0;
  const tree = render({ session, standing, signOut() { signedOut++; } });
  assert.ok(hasText(tree, "حساب الكابتن معتمد"));
  assert.equal(nodes(tree).filter(n => n.type === "AppearancePreferences").length, 1);
  const signOut = nodes(tree).find(n => n.props?.accessibilityRole === "button");
  assert.ok(signOut);
  signOut.props.onPress();
  assert.equal(signedOut, 1);
});

test("Captain account never claims approval for absent, foreign, invalid or unapproved standing", () => {
  for (const invalid of [undefined, { ...standing, actorId: "other" },
    { ...standing, status: "PENDING" }, { ...standing, version: 0 }, { ...standing, version: 1.5 }]) {
    const tree = render({ session, standing: invalid, signOut() {} });
    assert.ok(!hasText(tree, "حساب الكابتن معتمد"));
    assert.ok(nodes(tree).some(n => n.props?.accessibilityRole === "alert"));
  }
});
