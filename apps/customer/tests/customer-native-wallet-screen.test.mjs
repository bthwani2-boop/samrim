import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../src/features/wallet/wallet-screen.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-native-wallet-"));
let compiled;
try {
  const tsc = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), entry,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(tsc.status, 0, tsc.stderr || tsc.stdout);
  compiled = readFileSync(path.join(temp, "wallet-screen.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const wallet = actorId => ({ kind: "ready", balance: {
  actorId, currency: "YER", balanceYer: "9007199254740993",
}, expiresAt: Date.now() + 60000 });
const funding = id => ({
  fundingId: id, amountYer: "1500", postedAt: "2026-11-20T00:00:00Z",
});
const history = (actorId, items, nextCursor = null) => ({
  kind: "ready", history: {
    actorId, currency: "YER", items, hasMore: nextCursor !== null, nextCursor,
  }, expiresAt: Date.now() + 60000,
});

function harness() {
  const hooks = [];
  const requests = [];
  let index = 0, focus = null, focusCleanup = null, activeListener = null;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const appState = {
    currentState: "active",
    addEventListener(name, listener) {
      assert.equal(name, "change");
      activeListener = listener;
      return { remove() { activeListener = null; } };
    },
  };
  const modules = {
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "expo-router": {
      Link: "Link",
      useFocusEffect(callback) { focus = callback; },
    },
    react: {
      useCallback(callback) { return callback; },
      useState(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], value => {
          hooks[at] = typeof value === "function" ? value(hooks[at]) : value;
        }];
      },
      useRef(initial) {
        const at = index++;
        hooks[at] ??= { current: initial };
        return hooks[at];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": Object.fromEntries([
      ["AppState", appState], ...["Pressable", "ScrollView", "Text", "View"]
        .map(type => [type, type]),
    ]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./wallet-read": {
      readNativeWallet(signal) {
        return new Promise((resolve, reject) => requests.push({ kind: "wallet", signal, resolve, reject }));
      },
      readNativeWalletTransactions(signal, cursor, expectedActorId) {
        return new Promise((resolve, reject) => requests.push({
          kind: "history", signal, cursor, expectedActorId, resolve, reject,
        }));
      },
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => {
      assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`);
      return modules[name];
    }, mod, mod.exports,
  );
  const render = () => {
    index = 0;
    return mod.exports.default();
  };
  return {
    mount() {
      const view = render();
      assert.ok(focus, "Wallet screen must register its focus guard");
      focusCleanup = focus();
      return view;
    },
    render,
    read(kind) {
      const at = requests.findIndex(value => value.kind === kind);
      assert.notEqual(at, -1, `expected ${kind} WLT request`);
      return requests.splice(at, 1)[0];
    },
    appState(status) {
      appState.currentState = status;
      activeListener?.(status);
    },
    unmount() { focusCleanup?.(); focusCleanup = null; },
  };
}
function walk(node, predicate) {
  if (Array.isArray(node)) return node.map(child => walk(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return walk(node.props?.children, predicate);
}
const byId = (view, id) => walk(view, node => node.props?.testID === id) ?? null;
function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!node || typeof node !== "object") return "";
  return textOf(node.props?.children);
}

test("Native Android wallet renders only WLT verified funds and requests older history with the original cursor", async () => {
  const app = harness();
  try {
    app.mount();
    assert.equal(byId(app.render(), "native-wallet-balance"), null);
    app.read("wallet").resolve(wallet("actor-a"));
    await settle();
    const first = app.read("history");
    assert.equal(first.expectedActorId, "actor-a");
    first.resolve(history("actor-a", [funding("funding-old")], "next-page"));
    await settle();
    const view = app.render();
    assert.match(textOf(byId(view, "native-wallet-balance")), /ريال يمني/);
    assert.ok(byId(view, "native-wallet-more"));
    byId(view, "native-wallet-more").props.onPress();
    const next = app.read("history");
    assert.equal(next.cursor, "next-page");
    assert.equal(next.expectedActorId, "actor-a");
    next.resolve(history("actor-a", [{ ...funding("funding-new"), reversesFundingId: "funding-old" }]));
    await settle();
    const after = textOf(app.render());
    assert.match(after, /ريال يمني/);
    assert.match(after, /عكس تمويل −/);
    assert.equal(after.includes("عرض المزيد من المعاملات"), false);
  } finally { app.unmount(); }
});

test("Native wallet hides financial data immediately when sent to background, and late replies stay hidden", async () => {
  const app = harness();
  try {
    app.mount();
    app.read("wallet").resolve(wallet("actor-a"));
    await settle();
    const pending = app.read("history");
    assert.ok(byId(app.render(), "native-wallet-balance"));
    app.appState("background");
    assert.equal(pending.signal.aborted, true);
    assert.equal(byId(app.render(), "native-wallet-balance"), null);
    pending.resolve(history("actor-a", [funding("late-private")]));
    await settle();
    assert.equal(byId(app.render(), "native-wallet-balance"), null);
    app.appState("active");
    const resumed = app.read("wallet");
    assert.equal(resumed.signal.aborted, false);
    resumed.resolve({ kind: "signed-out" });
    await settle();
    assert.equal(byId(app.render(), "native-wallet-balance"), null);
    assert.match(textOf(app.render()), /تسجيل الدخول/);
  } finally { app.unmount(); }
});

test("Native wallet removes an old account after a revoked second Identity read", async () => {
  const app = harness();
  try {
    app.mount();
    app.read("wallet").resolve(wallet("actor-a"));
    await settle();
    app.read("history").resolve({ kind: "signed-out" });
    await settle();
    assert.equal(byId(app.render(), "native-wallet-balance"), null);
    assert.match(textOf(app.render()), /تسجيل الدخول/);
  } finally { app.unmount(); }
});

test("Native wallet does not append overlapping funding pages and can retry the same cursor", async () => {
  const app = harness();
  try {
    app.mount();
    app.read("wallet").resolve(wallet("actor-a"));
    await settle();
    app.read("history").resolve(history("actor-a", [funding("funding-old")], "page-two"));
    await settle();
    byId(app.render(), "native-wallet-more").props.onPress();
    const duplicate = app.read("history");
    duplicate.resolve(history("actor-a", [funding("funding-old")]));
    await settle();
    assert.ok(byId(app.render(), "native-wallet-more"), "failed continuation retains retry");
    assert.match(textOf(app.render()), /إعادة المحاولة/);
    byId(app.render(), "native-wallet-more").props.onPress();
    const retry = app.read("history");
    assert.equal(retry.cursor, "page-two");
    retry.resolve(history("actor-a", [funding("funding-new")]));
    await settle();
    assert.equal(byId(app.render(), "native-wallet-more"), null);
  } finally { app.unmount(); }
});

test("Unfocusing the native wallet aborts pending reads and prevents old account information from reappearing", async () => {
  const app = harness();
  app.mount();
  const inFlight = app.read("wallet");
  app.unmount();
  assert.equal(inFlight.signal.aborted, true);
  inFlight.resolve(wallet("actor-a"));
  await settle();
  assert.equal(byId(app.render(), "native-wallet-balance"), null);
});
