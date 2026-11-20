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
    path.join(root, "node_modules/typescript/bin/tsc"), source,
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
  const mocks = {
    "@bthwani/identity": { IdentityClientError: class extends Error {} },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
      background: "black", surface: "black", color: "white",
      colorSecondary: "white", interactiveText: "white", warningText: "red",
      borderColor: "gray",
    } }) },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
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
    "./dsh-standing": { MerchantStandingError: class extends Error {} },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    },
    mod, mod.exports,
    () => 1, () => undefined, () => 2, () => undefined,
  );
  const render = () => {
    index = 0;
    effects.length = 0;
    return mod.exports.default();
  };
  return {
    render,
    mount() {
      render();
      assert.equal(effects.length, 3);
      effects[0]();
    },
    startStanding() {
      render();
      effects[1]();
    },
    emit(state) {
      assert.equal(typeof appChanged, "function");
      appChanged(state);
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
