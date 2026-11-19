import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = fileURLToPath(new URL("../src/features/access/identity-gate.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-gate-"));
let compiled;
try {
  const task = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), entry,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(task.status, 0, task.stderr || task.stdout);
  compiled = readFileSync(path.join(temp, "identity-gate.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function harness() {
  const hooks = [];
  const effects = [];
  const requests = [];
  let index = 0;
  let onAppState;
  const jsx = (type, props) => ({ type, props: props ?? {} });
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
  const theme = {
    color: "#fff", colorSecondary: "#ccc", background: "#000",
    borderColor: "#444", interactiveText: "#fff", warningText: "#fff", surface: "#222",
  };
  const fake = {
    "@bthwani/identity": { IdentityClientError: class extends Error {} },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme }) },
    "expo-router": { Link: "Link" },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      AppState: {
        addEventListener(_event, handler) {
          onAppState = handler;
          return { remove() {} };
        },
      },
      Pressable: "Pressable", SafeAreaView: "SafeAreaView",
      ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
    },
    "./customer-session-transport": {
      readCustomerAdmission(signal) {
        return new Promise((resolve, reject) => requests.push({ signal, resolve, reject }));
      },
      async requestCustomerCode() { throw new Error("unrelated issue flow"); },
      async verifyCustomerCode() { throw new Error("unrelated verification flow"); },
      async signOutCustomer() { throw new Error("unrelated signout"); },
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compiled)(
    name => {
      assert.ok(Object.hasOwn(fake, name), `unexpected module ${name}`);
      return fake[name];
    }, mod, mod.exports, () => 1, () => undefined,
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
      assert.equal(effects.length, 1);
      effects[0]();
    },
    emit(state) {
      assert.equal(typeof onAppState, "function");
      onAppState(state);
    },
    read() {
      assert.ok(requests.length, "fresh owner session read should have started");
      return requests.shift();
    },
  };
}

function containsTestId(node, name) {
  if (Array.isArray(node)) return node.some(child => containsTestId(child, name));
  if (node === null || typeof node !== "object") return false;
  return node.props?.testID === name || containsTestId(node.props?.children, name);
}

const approved = {
  actorId: "customer-a", role: "customer",
  sessionExpiresAt: new Date(Date.now() + 120000).toISOString(),
};
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("background transition immediately conceals Customer verified-actor status", async () => {
  const h = harness();
  h.mount();
  h.read().resolve({ enabled: true, session: approved });
  await settle();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), true);
  h.emit("background");
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false,
    "backgrounded app must not display a possibly revoked Customer actor");
});

test("Customer background aborts stale Identity request and foreground starts fresh owner verification", async () => {
  const h = harness();
  h.mount();
  const stale = h.read();
  h.emit("background");
  assert.equal(stale.signal.aborted, true);
  h.emit("active");
  const fresh = h.read();
  stale.resolve({ enabled: true, session: approved });
  await settle();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false,
    "stale actor response must not authorize the UI");
  fresh.resolve({ enabled: true, session: null });
  await settle();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false);
});
