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
  colorSecondary: "muted", successText: "success", warningText: "warning", dangerText: "danger",
  interactiveText: "interactive", actionSoft: "soft" };

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function harness({ workspace = { session, standing, signOut() {} }, ready = true, save } = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), "captain-account-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), source, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const code = readFileSync(path.join(tmp, "account.js"), "utf8");
    const jsx = (type, props) => ({ type, props: props ?? {} });
    let preference = "system";
    const writes = [];
    const state = [];
    const refs = [];
    let slot = 0;
    let refSlot = 0;
    const mocks = {
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({
        theme, ready, preference,
        setPreference: async value => { writes.push(value); await save?.(value); preference = value; },
      }) },
      "react": {
        useState(initial) { const i = slot++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
        useRef(initial) { const i = refSlot++; refs[i] ??= { current: initial }; return refs[i]; },
      },
      "react-native": { ScrollView: "ScrollView", Text: "Text", View: "View", Pressable: "Pressable" },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "../../src/features/access/protected-route": { useCaptainWorkspace: () => workspace },
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    };
    const module = loadMappedRenderFixture(code, source, mocks);
    return { writes, render() { slot = 0; refSlot = 0; return module.exports.default(); } };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const radios = tree => nodes(tree).filter(n => n.props?.accessibilityRole === "radio");
const hasText = (tree, value) => nodes(tree).some(n => typeof n.props?.children === "string" && n.props.children.includes(value));

test("Captain account exposes three accessible theme choices backed by the existing preference writer", async () => {
  const app = harness();
  const initial = radios(app.render());
  assert.equal(initial.length, 3);
  assert.equal(initial[0].props.accessibilityState.checked, true);
  assert.deepEqual(initial.map(r => r.props["aria-checked"]), [true, false, false]);
  assert.deepEqual(initial.map(r => r.props.accessibilityLabel), ["\u062d\u0633\u0628 \u0627\u0644\u0646\u0638\u0627\u0645", "\u0641\u0627\u062a\u062d", "\u062f\u0627\u0643\u0646"]);
  await initial[2].props.onPress();
  assert.deepEqual(app.writes, ["dark"]);
  assert.equal(radios(app.render())[2].props.accessibilityState.checked, true);
  assert.deepEqual(radios(app.render()).map(r => r.props["aria-checked"]), [false, false, true]);
});

test("Captain account does not issue preference writes before restore or during a pending save", async () => {
  const restoring = harness({ ready: false });
  const disabled = radios(restoring.render());
  assert.equal(disabled.length, 3);
  assert.ok(disabled.every(r => r.props.disabled));
  await disabled[1].props.onPress();
  assert.deepEqual(restoring.writes, []);
  let finish;
  const app = harness({ save: () => new Promise(resolve => { finish = resolve; }) });
  const initial = radios(app.render());
  assert.equal(initial.length, 3);
  const first = initial[1].props.onPress();
  await initial[2].props.onPress();
  assert.ok(radios(app.render()).every(r => r.props.disabled));
  assert.deepEqual(app.writes, ["light"]);
  finish();
  await first;
  assert.equal(radios(app.render())[1].props.accessibilityState.checked, true);
  assert.deepEqual(radios(app.render()).map(r => r.props["aria-checked"]), [false, true, false]);
});

test("Captain account reports a failed save without inventing a persisted choice", async () => {
  const app = harness({ save: async () => { throw new Error("storage unavailable"); } });
  const options = radios(app.render());
  assert.equal(options.length, 3);
  await options[2].props.onPress();
  const tree = app.render();
  assert.equal(radios(tree)[0].props.accessibilityState.checked, true);
  assert.deepEqual(radios(tree).map(r => r.props["aria-checked"]), [true, false, false]);
  assert.ok(nodes(tree).some(n => n.props?.accessibilityRole === "alert"));
  assert.ok(radios(tree).every(r => !r.props.disabled));
});

test("Captain account never claims approval for another actor or mounts without a workspace", () => {
  assert.equal(harness({ workspace: null }).render(), null);
  assert.ok(hasText(harness().render(), "حساب الكابتن معتمد"));
  const foreign = harness({ workspace: { session, standing: { ...standing, actorId: "other" }, signOut() {} } });
  assert.ok(!hasText(foreign.render(), "حساب الكابتن معتمد"));
});
