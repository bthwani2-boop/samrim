import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceFile = fileURLToPath(new URL("../src/features/dispatch/captain-home-screen.tsx", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "captain-home-owner-"));
let code;
try {
  const output = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), sourceFile,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temporary,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(output.status, 0, output.stderr || output.stdout);
  code = readFileSync(path.join(temporary, "captain-home-screen.js"), "utf8");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const jsx = (type, props) => ({ type, props: props ?? {} });
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function renderHome(workspace, props) {
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
  return loadMappedRenderFixture(code, sourceFile, mocks).exports.default(props);
}
const session = { actorId: "captain-17", role: "captain",
  sessionExpiresAt: "2099-11-22T19:10:00Z" };
const standing = { actorId: session.actorId, status: "APPROVED", version: 17 };
const device = jsx("DeviceReadiness", {});
const texts = content => content.filter(n => typeof n.props?.children === "string").map(n => n.props.children).join(" ");

test("Captain Home presents human-readable owner approval, session expiry and no fictitious dispatch", () => {
  const content = nodes(renderHome({ session, standing }, { children: device }));
  const approved = content.find(n => n.props?.testID === "captain-standing-verified");
  assert.equal(approved?.props.children, "حساب الكابتن معتمد");
  const expiry = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(session.sessionExpiresAt));
  assert.ok(texts(content).includes(expiry));
  assert.doesNotMatch(texts(content), /DSH|Identity|نسخة السجل|captain-17/);
  assert.ok(content.some(n => n.type === "DeviceReadiness"));
  assert.ok(content.some(n => n.props?.children === "مهام التوصيل"));
  assert.ok(!content.some(n => n.props?.accessibilityRole === "button" &&
    /قبول|تسليم|مهمة/.test(String(n.props?.children))));
});

test("Captain Home withholds readiness controls for absent, foreign, pending or invalid-version standing", () => {
  for (const invalid of [undefined, { ...standing, actorId: "another-captain" },
    { ...standing, status: "PENDING" }, { ...standing, version: 0 },
    { ...standing, version: 1.5 }, { ...standing, version: Number.MAX_SAFE_INTEGER + 1 }]) {
    const content = nodes(renderHome({ session, standing: invalid }, { children: device }));
    assert.ok(!content.some(n => n.props?.testID === "captain-standing-verified"));
    assert.ok(content.some(n => n.props?.accessibilityRole === "alert"));
    assert.ok(!content.some(n => n.type === "DeviceReadiness"));
    assert.doesNotMatch(texts(content), /DSH|Identity|نسخة السجل/);
  }
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
