import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MerchantStandingError } from "../../../services/dsh/clients/merchant-standing.ts";
import { normalizeYemeniMobile } from "../../../services/identity/clients/phone-challenge.ts";
import { IdentityClientError } from "../../../services/identity/clients/transport.ts";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const root = new URL("../", import.meta.url);
const read = relative => readFileSync(new URL(relative, root), "utf8");

test("joining and setup share the canonical Identity Merchant gate, not an inert registration preview", () => {
  for (const route of ["src/features/onboarding/merchant-application.tsx",
    "src/features/onboarding/store-setup-screen.tsx"]) {
    const text = read(route);
    assert.match(text, /import MerchantIdentityGate from "\.\.\/access\/identity-gate";/);
    assert.match(text, route.includes("merchant-application")
      ? /return <MerchantIdentityGate mode="join" \/>;/
      : /return <MerchantIdentityGate \/>;/);
    assert.doesNotMatch(text, /MerchantCapabilityScreen|registerMerchantStore\(|fetch\(/);
  }
  assert.match(read("app/apply.tsx"), /onboarding\/merchant-application/);
  assert.match(read("app/setup.tsx"), /onboarding\/store-setup-screen/);
});
test("joining only reveals Store admission after both Identity and DSH owner standing", () => {
  const gate = read("src/features/access/identity-gate.tsx");
  const workspace = read("src/features/navigation/merchant-workspace.tsx");
  assert.match(gate, /standing\s*\?/);
  assert.match(gate, /تسجيل الدخول أو الانضمام/);
  assert.match(gate, /workspaceVisible = Boolean\(enabled && session && standing/);
  assert.match(gate, /!busy && standing\.session === session/);
  assert.match(gate, /silentChecking && standing\.session\.actorId === session\.actorId &&\s*standing\.session\.sessionExpiresAt === session\.sessionExpiresAt/);
  assert.match(gate, /accessibilityElementsHidden=\{!workspaceVisible\}/);
  assert.match(gate, /<MerchantWorkspace actorId=\{standing\.session\.actorId\}/);
  assert.match(workspace, /stores\.length === 0 \? \(\s*<View testID="merchant-onboarding-next-step"[\s\S]*?<MerchantStoreRegistration actorId=\{actorId\} onCreated=\{onRefresh\} \/>[\s\S]*?<\/View>\s*\) : \(/);
  assert.match(workspace, /<MerchantStoreRegistration actorId=\{actorId\} onCreated=\{onRefresh\}/);
  assert.doesNotMatch(read("src/features/onboarding/merchant-application.tsx"), /storeRegistration:|role:\s*["']merchant/);
});

test("merchant login visibly links to the dedicated public joining entry on web and Android", () => {
  const gate = read("src/features/access/identity-gate.tsx");
  const entry = read("src/features/onboarding/merchant-application.tsx");
  assert.match(gate, /<Link href="\/apply" asChild>/);
  assert.match(gate, /انضم كتاجر/);
  assert.match(gate, /<Link href="\/" asChild>/);
  assert.match(gate, /العودة إلى تسجيل الدخول/);
  assert.match(gate, /mode === "join"/);
  assert.match(entry, /<MerchantIdentityGate mode="join" \/>/);
  assert.doesNotMatch(entry, /registerMerchantStore\(|fetch\(/);
});

const gateSource = fileURLToPath(new URL("../src/features/access/identity-gate.tsx", import.meta.url));
const loadedGateModules = [];
process.once("exit", () => loadedGateModules.length);

function compileGate() {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const scratch = mkdtempSync(join(tmpdir(), "bthwani-merchant-gate-"));
  let compiled;
  try {
    const output = spawnSync(process.execPath, [
      join(repo, "node_modules/@typescript/native/bin/tsc"), gateSource,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", scratch,
    ], { cwd: repo, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(output.status, 0, output.stderr || output.stdout);
    compiled = readFileSync(join(scratch, "identity-gate.js"), "utf8");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return compiled;
}

const compiledGate = compileGate();

function gateHarness(t) {
  const slots = [], admission = [], standing = [], signouts = [];
  const timers = new Map();
  let index = 0, sequence = 0, effects = [], changed;
  const appState = { currentState: "active", addEventListener(_name, fn) {
    changed = fn;
    return { remove() { changed = undefined; } };
  } };
  const defer = (queue, signal) => new Promise((resolve, reject) => queue.push({ signal, resolve, reject }));
  const take = queue => { assert.ok(queue.length, "expected owner request"); return queue.shift(); };
  const hook = create => {
    const at = index++;
    if (!(at in slots)) slots[at] = create();
    return { at, value: slots[at] };
  };
  const same = (a, b) => a?.length === b.length && b.every((value, i) => Object.is(a[i], value));
  const react = {
    useState(initial) {
      const { at, value } = hook(() => initial);
      return [value, next => { slots[at] = typeof next === "function" ? next(slots[at]) : next; }];
    },
    useRef(initial) { return hook(() => ({ current: initial })).value; },
    useCallback(fn, deps) {
      const { at, value } = hook(() => ({ fn, deps }));
      if (!same(value.deps, deps)) slots[at] = { fn, deps };
      return slots[at].fn;
    },
    useEffect(fn, deps) {
      const at = index++, previous = slots[at];
      if (!previous || !same(previous.deps, deps)) {
        effects.push(() => { previous?.cleanup?.(); slots[at] = { deps, cleanup: fn() }; });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const mod = loadMappedRenderFixture(compiledGate, gateSource, {
    "@bthwani/identity": { IdentityClientError, normalizeYemeniMobile },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "expo-router": { Link: "Link" },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { AppState: appState, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" },
    "../navigation/merchant-entry-shell": { default: "MerchantEntryShell" },
    "../navigation/merchant-workspace": { default: "MerchantWorkspace" },
    "@bthwani/dsh": { MerchantStandingError },
    "./admission-transport": {
      readAdmission: signal => defer(admission, signal),
      readMerchantStanding: signal => defer(standing, signal),
      signOutOfAdmission: signal => defer(signouts, signal),
      requestAdmissionCode: () => assert.fail("unexpected code request"),
      submitAdmissionCode: () => assert.fail("unexpected admission submission"),
    },
  });
  loadedGateModules.push(mod);
  t.mock.method(globalThis, "setTimeout", (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; });
  t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
  t.mock.method(globalThis, "setInterval", () => ++sequence);
  t.mock.method(globalThis, "clearInterval", () => {});
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); });
  function render() {
    index = 0;
    effects = [];
    const tree = mod.exports.default({});
    for (const fn of effects) fn();
    return tree;
  }
  return {
    render, admission: () => take(admission), standing: () => take(standing), signout: () => take(signouts),
    changed(state) { appState.currentState = state; changed(state); },
    standingDeadline() {
      const item = [...timers].find(([, timer]) => timer.delay === 20000);
      assert.ok(item, "owner read must have a deadline");
      timers.delete(item[0]); item[1].fn();
    },
  };
}

function gateNodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(gateNodes);
  return [tree, ...gateNodes(tree.props?.children)];
}
const workspace = tree => gateNodes(tree).find(node => node.props.testID === "merchant-verified-workspace");
const gateSession = actorId => ({ enabled: true, session: { actorId, role: "merchant", sessionExpiresAt: new Date(Date.now() + 60000).toISOString() } });
const gateStanding = (actorId, storeId) => ({ actorId, stores: [{ id: storeId, name: "Synthetic store", relation: "MARKETPLACE", published: true }] });
const settleGate = () => new Promise(resolve => setImmediate(resolve));

test("Merchant workspace requires matching DSH standing; owner timeout and wrong actor fail closed", async t => {
  const h = gateHarness(t);
  assert.equal(workspace(h.render()), undefined);
  h.admission().resolve(gateSession("merchant-a"));
  await settleGate();
  assert.equal(workspace(h.render()), undefined, "Identity alone must not expose Store content");
  const expired = h.standing();
  h.standingDeadline();
  assert.equal(expired.signal.aborted, true);
  expired.resolve(gateStanding("merchant-a", "store-a"));
  await settleGate();
  assert.equal(workspace(h.render()), undefined, "late result after deadline is rejected");

  h.changed("active");
  h.admission().resolve(gateSession("merchant-a"));
  await settleGate();
  h.render();
  h.standing().resolve(gateStanding("merchant-b", "store-b"));
  await settleGate();
  assert.equal(workspace(h.render()), undefined, "cross-actor standing never authorizes a Store");
  h.changed("active");
  h.admission().resolve(gateSession("merchant-a"));
  await settleGate();
  h.render();
  h.standing().resolve(gateStanding("merchant-a", "store-a"));
  await settleGate();
  const current = workspace(h.render());
  assert.equal(current.props.pointerEvents, "auto");
  assert.equal(current.props.accessibilityElementsHidden, false);
  assert.equal(current.props.children.props.actorId, "merchant-a");
  assert.deepEqual(current.props.children.props.stores, gateStanding("merchant-a", "store-a").stores);
});

test("Merchant backgrounding rejects late standing; new actor and explicit logout discard private workspace", async t => {
  const h = gateHarness(t);
  h.render();
  h.admission().resolve(gateSession("merchant-a"));
  await settleGate();
  h.render();
  const late = h.standing();
  h.changed("background");
  assert.equal(late.signal.aborted, true);
  late.resolve(gateStanding("merchant-a", "store-a"));
  await settleGate();
  assert.equal(workspace(h.render()), undefined);

  h.changed("active");
  h.admission().resolve(gateSession("merchant-b"));
  await settleGate();
  h.render();
  h.standing().resolve(gateStanding("merchant-b", "store-b"));
  await settleGate();
  const visible = workspace(h.render());
  assert.equal(visible.props.children.props.actorId, "merchant-b");
  assert.equal(visible.props.pointerEvents, "auto");
  h.changed("background");
  const concealed = workspace(h.render());
  assert.equal(concealed.props.pointerEvents, "none");
  assert.equal(concealed.props.accessibilityElementsHidden, true);
  h.changed("active");
  h.admission().resolve(gateSession("merchant-c"));
  await settleGate();
  assert.equal(workspace(h.render()), undefined, "previous actor tree must be removed");
  h.standing().resolve(gateStanding("merchant-c", "store-c"));
  await settleGate();
  const next = workspace(h.render());
  assert.equal(next.props.children.props.actorId, "merchant-c");
  assert.notEqual(next.key, visible.key);
  next.props.children.props.onSignOut();
  const logout = h.signout();
  assert.equal(workspace(h.render()), undefined, "logout conceals before owner reply");
  logout.resolve();
  await settleGate();
  assert.equal(workspace(h.render()), undefined);
});
