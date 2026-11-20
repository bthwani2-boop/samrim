import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/access/identity-gate.tsx", import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-captain-entry-"));
let compiled;
try {
  const output = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", tmp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(output.status, 0, output.stderr || output.stdout);
  compiled = readFileSync(path.join(tmp, "identity-gate.js"), "utf8");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function harness() {
  const hooks = [];
  const effects = [];
  const pending = [];
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
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const mocks = {
    "@bthwani/identity": { IdentityClientError: class extends Error {} },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
      background: "black", surface: "black", color: "white",
      colorSecondary: "white", interactiveText: "white", warningText: "red",
      borderColor: "gray", actionBackground: "primary", onAction: "white", successText: "green",
    } }) },
    "expo-router": { Link: "Link" },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      AppState: { addEventListener(_type, cb) {
        appChanged = cb;
        return { remove() {} };
      } },
      Pressable: "Pressable",
      ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./admission-transport": {
      readCaptainAdmission(signal) {
        return new Promise((resolve, reject) => pending.push({ signal, resolve, reject }));
      },
    },
    "./captain-session": {
      hasActiveCaptainSession(session) { return session?.role === "captain"; },
    },
    "./captain-standing": { CaptainStandingError: class extends Error {} },
    "./captain-entry-shell": { __esModule: true, default: "CaptainEntryShell" },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", "setTimeout", "clearTimeout", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    }, module, module.exports, false, () => 1, () => undefined
  );
  const render = () => {
    index = 0;
    effects.length = 0;
    return module.exports.default();
  };
  return {
    render,
    mount() {
      render();
      const first = effects[0];
      assert.equal(typeof first, "function");
      first();
    },
    emit(state) {
      assert.equal(typeof appChanged, "function");
      appChanged(state);
    },
    next() {
      assert.ok(pending.length, "expected a new owner session check");
      return pending.shift();
    },
  };
}

function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function verifiedUI(tree) {
  return nodes(tree).some(node => node.props?.testID === "captain-admission-verified");
}
function guestNavigation(tree) {
  return nodes(tree).some(node => node.type === "CaptainEntryShell");
}
function homeLink(tree) {
  return nodes(tree).find(node => node.type === "Link" && node.props?.href === "/home");
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
function approved() {
  return { enabled: true, session: {
    actorId: "prior-captain", role: "captain",
    sessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  } };
}

test("background aborts in-flight Captain admission and foreground forces fresh owner read", async () => {
  const h = harness();
  h.mount();
  h.next().resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), true, "initial owner-approved Captain should appear");
  assert.equal(guestNavigation(h.render()), false, "approved Captain uses protected real tabs instead of preview");
  assert.equal(homeLink(h.render())?.props.children.props.style.backgroundColor, "primary");

  h.emit("active");
  const stale = h.next();
  assert.equal(verifiedUI(h.render()), false, "pending owner check hides old approval");

  h.emit("background");
  assert.equal(stale.signal.aborted, true, "background must cancel an unresolved owner check");
  h.emit("active");
  const fresh = h.next();

  stale.resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), false, "aborted old result must never authorize entry");

  fresh.resolve({ enabled: true, session: null });
  await settle();
  assert.equal(verifiedUI(h.render()), false, "fresh denied owner session stays denied");
  assert.equal(guestNavigation(h.render()), true, "denied Captain sees disabled public navigation preview");
  assert.equal(homeLink(h.render()), undefined);
  const phone = nodes(h.render()).find(node => node.type === "TextInput");
  assert.equal(phone?.props.accessibilityLabel, "رقم الهاتف التجريبي");
  const sendButton = nodes(h.render()).find(node => node.type === "Pressable" &&
    node.props.children.props.children === "إرسال رمز التحقق");
  assert.equal(sendButton?.props.accessibilityState.disabled, true);
});

test("Captain admission offers an accessible retry after an owner outage", async () => {
  const h = harness();
  h.mount();
  h.next().reject(new Error("owner unreachable"));
  await settle();
  const tree = h.render();
  assert.equal(homeLink(tree), undefined);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === "alert"));
  const retry = nodes(tree).find(node => node.type === "Pressable" &&
    node.props.children.props.children === "إعادة التحقق");
  assert.equal(retry?.props.accessibilityState.disabled, false);
  retry.props.onPress();
  h.next().resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), true);
  assert.ok(homeLink(h.render()));
});
