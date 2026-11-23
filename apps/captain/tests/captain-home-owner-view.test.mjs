import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceFile = fileURLToPath(new URL("../src/features/dispatch/captain-home-screen.tsx", import.meta.url));

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function renderHome(workspace) {
  const tmp = mkdtempSync(path.join(tmpdir(), "captain-home-owner-"));
  try {
    const output = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), sourceFile,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(output.status, 0, output.stderr || output.stdout);
    const code = readFileSync(path.join(tmp, "captain-home-screen.js"), "utf8");
    const jsx = (type, props) => ({ type, props: props ?? {} });
    const mocks = {
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({
        theme: { background: "bg", surface: "surface", borderColor: "border", color: "text",
          colorSecondary: "muted", successText: "success", warningText: "warning" },
      }) },
      "react-native": { ScrollView: "ScrollView", Text: "Text", View: "View" },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "../access/protected-route": { useCaptainWorkspace: () => workspace },
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    };
    const module = { exports: {} };
    new Function("require", "module", "exports", code)(name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    }, module, module.exports);
    return module.exports.default();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const session = { actorId: "captain-17", role: "captain",
  sessionExpiresAt: "2099-11-22T19:10:00Z" };
const standing = { actorId: "captain-17", status: "APPROVED", version: 17 };

test("Captain Home shows only the owner-verified DSH standing and session expiry", () => {
  const tree = renderHome({ session, standing });
  const content = nodes(tree);
  const approved = content.find(n => n.props?.testID === "captain-standing-verified");
  assert.ok(approved, "the DSH owner-approved standing must be visible");
  assert.equal(approved.props.children.includes("17"), true, "show the current DSH standing version");
  assert.ok(content.some(n => typeof n.props?.children === "string" &&
    n.props.children.includes("2099")), "session expiry must use actual Identity value");
  assert.ok(!content.some(n => n.props?.accessibilityRole === "button" &&
    /قبول|تسليم|مهمة/.test(String(n.props?.children))), "no unauthorized dispatch or success action");
});

test("Captain Home never displays a foreign actor's standing as approved", () => {
  const tree = renderHome({ session, standing: { ...standing, actorId: "another-captain" } });
  assert.ok(!nodes(tree).some(n => n.props?.testID === "captain-standing-verified"));
});

test("Captain Home does not mount outside verified workspace", () => {
  assert.equal(renderHome(null), null);
});

test("Captain admission forwards actual DSH result to the protected workspace", () => {
  const transport = readFileSync(new URL("../src/features/access/admission-transport.ts", import.meta.url), "utf8");
  const guard = readFileSync(new URL("../src/features/access/protected-route.tsx", import.meta.url), "utf8");
  assert.match(transport, /const standing = await readApprovedCaptainStanding\(/);
  assert.match(transport, /stillCurrent \? \{ standing \} : \{\}/);
  assert.match(guard, /result\.standing/);
  assert.match(guard, /standing: verified\.standing/);
});
