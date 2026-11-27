import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/access/identity-gate.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-entry-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "identity-gate.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function harness() {
  const hooks = [];
  const effects = [];
  const admissions = [];
  const standings = [];
  let index = 0;
  let appChanged;
  let actionTimeout;
  let periodic;
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
    },
    useRef(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = { current: initial };
      return hooks[at];
    },
    useCallback(fn) { index++; return fn; },
    useEffect(fn) { index++; effects.push(fn); },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  class StandingError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const mocks = {
    "@bthwani/identity": { IdentityClientError: class extends Error {}, normalizeYemeniMobile: () => undefined },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
      background: "black", surface: "black", color: "white",
      colorSecondary: "white", interactiveText: "white", warningText: "red",
      borderColor: "gray",
    } }) },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "expo-router": { Link: "Link" },
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener(_type, handler) {
          appChanged = handler;
          return { remove() {} };
        },
      },
      Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text",
      TextInput: "TextInput", View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../navigation/merchant-entry-shell": { __esModule: true, default: "MerchantEntryShell" },
    "../navigation/merchant-workspace": { __esModule: true, default: "MerchantWorkspace" },
    "./admission-transport": {
      readAdmission(signal) {
        return new Promise((resolve, reject) => admissions.push({ signal, resolve, reject }));
      },
      readMerchantStanding(signal) {
        return new Promise((resolve, reject) => standings.push({ signal, resolve, reject }));
      },
    },
    "./dsh-standing": { MerchantStandingError: StandingError },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    },
    mod, mod.exports,
    callback => { actionTimeout = callback; return 1; }, () => undefined, callback => { periodic = callback; return 2; }, () => undefined,
  );
  const render = () => {
    index = 0;
    effects.length = 0;
    return mod.exports.default({});
  };
  return {
    render,
    standingDenied: () => new StandingError(403, "STORE_ACCESS_DENIED"),
    mount() {
      render();
      assert.equal(effects.length, 3);
      effects[0]();
    },
    startPolling() {
      render();
      effects[2]();
    },
    poll() { periodic(); },
    startStanding() {
      render();
      effects[1]();
    },
    emit(state) {
      assert.equal(typeof appChanged, "function");
      appChanged(state);
    },
    timeoutAction() {
      assert.equal(typeof actionTimeout, "function");
      actionTimeout();
    },
    nextAdmission() {
      assert.ok(admissions.length, "a new Identity owner check must have started");
      return admissions.shift();
    },
    nextStanding() {
      assert.ok(standings.length, "a DSH standing owner check must have started");
      return standings.shift();
    },
  };
}

const approvedSession = {
  actorId: "merchant-test-a",
  role: "merchant",
  sessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
};
const workspace = tree => tree.props.children[0];
const visible = view => view?.props.pointerEvents === "auto";
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function findNode(node, matches) {
  if (Array.isArray(node)) return node.map(child => findNode(child, matches)).find(Boolean);
  if (node && typeof node === "object") {
    return matches(node) ? node : findNode(node.props?.children, matches);
  }
}

test("sending without a typed phone explains the missing input", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: null });
  await settle();
  const send = findNode(h.render(), node => node.type === "Pressable" &&
    node.props.children?.props.children === "إرسال رمز التحقق");
  assert.ok(send);
  assert.equal(send.props.disabled, false);
  send.props.onPress();
  assert.ok(findNode(h.render(), node => node.props.accessibilityRole === "alert" &&
    node.props.children === "اكتب رقم الهاتف اليمني للاختبار، مثل 770000001."));
});

test("Merchant workspace is concealed immediately when app enters background", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  assert.equal(visible(workspace(h.render())), true, "valid current Identity and DSH grants show workspace");
  h.emit("background");
  assert.equal(visible(workspace(h.render())), false,
    "background transition must hide Store-scoped information before returning to app");
});

test("Merchant background aborts stale owner check and foreground requires a fresh one", async () => {
  const h = harness();
  h.mount();
  const stale = h.nextAdmission();
  h.emit("background");
  assert.equal(stale.signal.aborted, true, "background must cancel an unresolved Identity response");
  h.emit("active");
  const fresh = h.nextAdmission();
  stale.resolve({ enabled: true, session: approvedSession });
  await settle();
  assert.equal(workspace(h.render()), null, "late stale approval cannot reopen Store workspace");
  fresh.resolve({ enabled: true, session: null });
  await settle();
  assert.equal(workspace(h.render()), null, "fresh revoked session keeps workspace closed");
});

test("revalidating the same session preserves its workspace key while private content is concealed", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  const initial = workspace(h.render());
  assert.equal(visible(initial), true);

  h.emit("background");
  const concealed = workspace(h.render());
  assert.equal(concealed.key, initial.key);
  assert.deepEqual(concealed.props.style, { display: "none" });
  assert.equal(concealed.props.accessibilityElementsHidden, true);
  assert.equal(visible(concealed), false);

  h.emit("active");
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  assert.equal(visible(workspace(h.render())), false, "Identity alone does not reopen the workspace");
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  const verifiedAgain = workspace(h.render());
  assert.equal(verifiedAgain.key, initial.key);
  assert.equal(visible(verifiedAgain), true);
});

test("a different actor invalidates the old workspace before DSH grants arrive", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  const initial = workspace(h.render());
  initial.props.children.props.onRefresh();
  assert.equal(visible(workspace(h.render())), false);
  const other = { ...approvedSession, actorId: "merchant-test-b" };
  h.nextAdmission().resolve({ enabled: true, session: other });
  await settle();
  assert.equal(workspace(h.render()), null);
  h.startStanding();
  h.nextStanding().resolve({ actorId: other.actorId, stores: [] });
  await settle();
  const current = workspace(h.render());
  assert.equal(visible(current), true);
  assert.notEqual(current.key, initial.key);
  assert.equal(current.props.children.props.actorId, other.actorId);
});


test("Merchant timed-out Identity revalidation requires recovery instead of starting a second login", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  const initial = workspace(h.render());
  assert.equal(visible(initial), true);
  initial.props.children.props.onRefresh();
  const pending = h.nextAdmission();
  h.timeoutAction();
  assert.equal(pending.signal.aborted, true);
  pending.reject(new Error("aborted"));
  await settle();
  const tree = h.render();
  assert.equal(visible(workspace(tree)), false);
  const retry = findNode(tree, node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق من الجلسة");
  assert.ok(retry);
  assert.equal(findNode(tree, node => node.type === "TextInput" &&
    node.props.accessibilityLabel === "رقم هاتف الاختبار"), undefined);
  retry.props.onPress();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  assert.equal(visible(workspace(h.render())), false);
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  const recovered = workspace(h.render());
  assert.equal(visible(recovered), true);
  assert.equal(recovered.key, initial.key);
});


test("a noncooperative Merchant Identity read releases retry at its deadline and cannot disturb its successor", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  workspace(h.render()).props.children.props.onRefresh();
  const stale = h.nextAdmission();
  h.timeoutAction();
  assert.equal(stale.signal.aborted, true);
  const tree = h.render();
  assert.equal(visible(workspace(tree)), false);
  assert.equal(findNode(tree, node => node.type === "TextInput" &&
    node.props.accessibilityLabel === "رقم هاتف الاختبار"), undefined);
  const retry = findNode(tree, node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق من الجلسة");
  assert.ok(retry);
  assert.equal(retry.props.disabled, false, "deadline must release retry without waiting for stale read");
  retry.props.onPress();
  const fresh = h.nextAdmission();
  stale.resolve({ enabled: true, session: approvedSession });
  await settle();
  assert.equal(visible(workspace(h.render())), false);
  const pendingRetry = findNode(h.render(), node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق من الجلسة");
  assert.equal(pendingRetry.props.disabled, true, "late completion must not clear successor busy state");
  fresh.resolve({ enabled: true, session: approvedSession });
  await settle();
  assert.equal(visible(workspace(h.render())), false);
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  assert.equal(visible(workspace(h.render())), true);
});

test("DSH denial conceals Merchant workspace without prompting for a new OTP", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  workspace(h.render()).props.children.props.onRefresh();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().reject(h.standingDenied());
  await settle();
  const denied = h.render();
  assert.equal(visible(workspace(denied)), false);
  assert.equal(findNode(denied, node => node.type === "TextInput" && node.props.accessibilityLabel === "رقم هاتف الاختبار"), undefined);
  const retry = findNode(denied, node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق من المتاجر");
  assert.ok(retry, "a DSH refusal must offer standing recovery");
  retry.props.onPress();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  assert.equal(visible(workspace(h.render())), true);
});

test("healthy Merchant polling retains workspace through Identity and DSH revalidation", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  const initial = workspace(h.render());
  assert.equal(visible(initial), true);
  h.startPolling();
  h.poll();
  assert.equal(visible(workspace(h.render())), true);
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  assert.equal(visible(workspace(h.render())), true);
  h.startStanding();
  assert.equal(visible(workspace(h.render())), true);
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  assert.equal(visible(workspace(h.render())), true);
  assert.equal(workspace(h.render()).key, initial.key);
  h.poll();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().reject(h.standingDenied());
  await settle();
  assert.equal(visible(workspace(h.render())), false);
});

test("timed-out Merchant standing poll conceals workspace and rejects a late result", async () => {
  const h = harness();
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  h.startPolling();
  h.poll();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  const delayed = h.nextStanding();
  assert.equal(visible(workspace(h.render())), true);
  h.timeoutAction();
  assert.equal(delayed.signal.aborted, true);
  assert.equal(visible(workspace(h.render())), false);
  delayed.resolve({ actorId: approvedSession.actorId, stores: [] });
  await settle();
  assert.equal(visible(workspace(h.render())), false);
});

test("Merchant renewal retains the mounted same-actor workspace but requires fresh DSH approval", async () => {
  const h = harness();
  const store = { id: "store-a", name: "Store A", relation: "DIRECT", published: true };
  h.mount();
  h.nextAdmission().resolve({ enabled: true, session: approvedSession });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: approvedSession.actorId, stores: [store] });
  await settle();
  const initial = workspace(h.render());
  h.startPolling();
  h.poll();
  const renewed = { ...approvedSession, sessionExpiresAt: new Date(Date.now() + 240000).toISOString() };
  h.nextAdmission().resolve({ enabled: true, session: renewed });
  await settle();
  const concealed = workspace(h.render());
  assert.ok(concealed, "renewal must not unmount the previous workspace while checking");
  assert.equal(concealed.key, initial.key);
  assert.equal(visible(concealed), false, "fresh DSH approval is still required");
  h.startStanding();
  h.nextStanding().resolve({ actorId: renewed.actorId, stores: [store] });
  await settle();
  assert.equal(workspace(h.render()).key, initial.key);
  assert.equal(visible(workspace(h.render())), true);
  h.poll();
  h.nextAdmission().resolve({ enabled: true, session: renewed });
  await settle();
  h.startStanding();
  h.nextStanding().resolve({ actorId: renewed.actorId, stores: [] });
  await settle();
  assert.notEqual(workspace(h.render()).key, initial.key, "changed Store scope resets protected state");
});
