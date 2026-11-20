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
  const timeouts = new Map();
  const intervals = new Map();
  let now = Date.now();
  let timerID = 0;
  let index = 0;
  let onAppState;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
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
    useCallback(fn, deps) {
      const at = index++;
      if (!sameDeps(hooks[at]?.deps, deps)) hooks[at] = { deps, fn };
      return hooks[at].fn;
    },
    useEffect(fn, deps) {
      const at = index++;
      if (sameDeps(hooks[at]?.deps, deps)) return;
      effects.push(() => {
        hooks[at]?.cleanup?.();
        hooks[at] = { deps, cleanup: fn() };
      });
    },
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
        currentState: "active",
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
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", compiled)(
    name => {
      assert.ok(Object.hasOwn(fake, name), `unexpected module ${name}`);
      return fake[name];
    }, mod, mod.exports,
    (fn, delay) => { const id = ++timerID; timeouts.set(id, { fn, at: now + delay }); return id; },
    id => timeouts.delete(id),
    (fn, delay) => { const id = ++timerID; intervals.set(id, { fn, delay }); return id; },
    id => intervals.delete(id),
    class extends Date { static now() { return now; } },
  );
  const render = () => {
    index = 0;
    effects.length = 0;
    const view = mod.exports.default();
    for (const effect of effects) effect();
    return view;
  };
  return {
    render,
    mount() {
      render();
    },
    emit(state) {
      assert.equal(typeof onAppState, "function");
      fake["react-native"].AppState.currentState = state;
      onAppState(state);
    },
    session(ttl = 120000) {
      return { ...approved, sessionExpiresAt: new Date(now + ttl).toISOString() };
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of timeouts) {
        if (timer.at <= now) { timeouts.delete(id); timer.fn(); }
      }
    },
    poll() {
      assert.equal(intervals.size, 1, "a verified session must periodically revalidate with Identity");
      const timer = [...intervals.values()][0];
      assert.ok(timer.delay > 0 && timer.delay <= 30000);
      timer.fn();
    },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
    timerCount: () => timeouts.size + intervals.size,
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

test("Customer verified status expires while continuously in the foreground", async () => {
  const h = harness();
  h.mount();
  h.read().resolve({ enabled: true, session: h.session(1000) });
  await settle();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), true);
  h.advance(1000);
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false);
});

test("Customer foreground polling hides stale status and fails closed on owner outage", async () => {
  const h = harness();
  h.mount();
  h.read().resolve({ enabled: true, session: h.session() });
  await settle();
  h.render();
  h.poll();
  const fresh = h.read();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false);
  fresh.reject(new Error("Identity unavailable"));
  await settle();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false);
});

test("Customer foreground polling observes session revocation", async () => {
  const h = harness();
  h.mount();
  h.read().resolve({ enabled: true, session: h.session() });
  await settle();
  h.render();
  h.poll();
  h.read().resolve({ enabled: true, session: null });
  await settle();
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), false);
});

test("Customer refresh replaces old expiry timers and unmount releases all timers", async () => {
  const h = harness();
  h.mount();
  h.read().resolve({ enabled: true, session: h.session(1000) });
  await settle();
  h.render();
  h.poll();
  h.read().resolve({ enabled: true, session: h.session(120000) });
  await settle();
  h.render();
  h.advance(1000);
  assert.equal(containsTestId(h.render(), "customer-identity-verified"), true,
    "the earlier session's deadline must not expire a freshly owner-verified session");
  h.unmount();
  assert.equal(h.timerCount(), 0);
});
