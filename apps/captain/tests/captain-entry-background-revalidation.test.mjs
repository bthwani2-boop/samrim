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
    path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
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
  let deadline;
  let timerId = 0;
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
    "@bthwani/identity": { IdentityClientError: class extends Error {},
      normalizeYemeniMobile: value => /^7\d{8}$/.test(value) ? "+967" + value : undefined },
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
      async requestCaptainPhoneCode() { return "issued-ticket"; },
      async verifyCaptainCode() { return { state: "pending" }; },
    },
    "./captain-session": {
      hasActiveCaptainSession(session) { return session?.role === "captain"; },
    },
    "@bthwani/dsh": { CaptainStandingError: class extends Error {} },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", "setTimeout", "clearTimeout", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    }, module, module.exports, false,
    fn => { deadline = { fn, id: ++timerId }; return timerId; },
    id => { if (deadline?.id === id) deadline = undefined; }
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
    timeout() { assert.ok(deadline); const timer = deadline; deadline = undefined; timer.fn(); },
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
  return nodes(tree).some(node => node.props?.accessibilityRole === "tab");
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

test("Identity-only Captain entry shows phone login without consuming OTP or mounting workspace", async () => {
  const h = harness();
  h.mount();
  h.next().resolve({ enabled: true, standingReady: false, session: null });
  await settle();

  const guest = nodes(h.render());
  assert.ok(guest.some(node => node.props?.children === "تسجيل دخول الكابتن"));
  assert.ok(guest.some(node => node.props?.testID === "captain-standing-service-unavailable"));
  assert.equal(verifiedUI(h.render()), false);
  assert.equal(guestNavigation(h.render()), false);
  assert.equal(homeLink(h.render()), undefined);

  const phone = guest.find(node => node.type === "TextInput" &&
    node.props.accessibilityLabel === "رقم الهاتف التجريبي");
  assert.ok(phone, "Identity-only state keeps the real phone input visible");
  phone.props.onChangeText("770000001");
  const send = nodes(h.render()).find(node => node.type === "Pressable" &&
    node.props.children.props.children === "إرسال رمز التحقق");
  assert.equal(send.props.accessibilityState.disabled, true,
    "no phone challenge can be issued without DSH standing");

  h.emit("active");
  h.next().resolve({ enabled: true, standingReady: true, session: null });
  await settle();
  const ready = nodes(h.render());
  assert.equal(ready.some(node => node.props?.testID === "captain-standing-service-unavailable"), false);
  const enabledSend = ready.find(node => node.type === "Pressable" &&
    node.props.children.props.children === "إرسال رمز التحقق");
  assert.equal(enabledSend.props.accessibilityState.disabled, false,
    "ready Identity and DSH expose the active authentication flow");
});

test("confirmed pending application retains phone and explains proof-bound recheck", async () => {
  const h = harness();
  h.mount();
  h.next().resolve({ enabled: true, standingReady: true, session: null });
  await settle();
  const phoneInput = nodes(h.render()).find(node =>
    node.type === "TextInput" && node.props.accessibilityLabel === "رقم الهاتف التجريبي");
  assert.ok(phoneInput);
  phoneInput.props.onChangeText("770000001");
  const send = nodes(h.render()).find(node => node.type === "Pressable" &&
    node.props.children?.props?.children === "إرسال رمز التحقق");
  assert.ok(send);
  send.props.onPress();
  await settle();
  const otpInput = nodes(h.render()).find(node =>
    node.type === "TextInput" && node.props.accessibilityLabel === "رمز التحقق");
  assert.ok(otpInput);
  otpInput.props.onChangeText("123456");
  const confirm = nodes(h.render()).find(node => node.type === "Pressable" &&
    node.props.children?.props?.children === "التحقق من حساب الكابتن");
  assert.ok(confirm);
  confirm.props.onPress();
  await settle();

  const pendingScreen = nodes(h.render());
  assert.ok(pendingScreen.some(node => node.props?.testID === "captain-admission-pending"),
    "only DSH-confirmed pending state produces the waiting message");
  const preservedPhone = pendingScreen.find(node => node.type === "TextInput" &&
    node.props.accessibilityLabel === "رقم الهاتف التجريبي");
  assert.equal(preservedPhone?.props.value, "770000001");
  const recheck = pendingScreen.find(node => node.type === "Pressable" &&
    node.props.children?.props?.children === "إرسال رمز جديد للتحقق من حالة الطلب");
  assert.ok(recheck, "a new OTP is required for the next status check");
  assert.equal(recheck.props.accessibilityState.disabled, false);
  assert.equal(verifiedUI(h.render()), false);
  assert.equal(guestNavigation(h.render()), false);
});

test("background aborts in-flight Captain admission and foreground forces fresh owner read", async () => {
  const h = harness();
  h.mount();
  h.next().resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), true, "initial owner-approved Captain should appear");
  assert.equal(guestNavigation(h.render()), false, "entry screen contains no simulated workspace tabs");
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
  assert.equal(guestNavigation(h.render()), false, "denied Captain never sees misleading disabled navigation tabs");
  assert.equal(homeLink(h.render()), undefined);
  const phone = nodes(h.render()).find(node => node.type === "TextInput");
  assert.equal(phone?.props.accessibilityLabel, "رقم الهاتف التجريبي");
  const sendButton = nodes(h.render()).find(node => node.type === "Pressable" &&
    node.props.children.props.children === "إرسال رمز التحقق");
  assert.equal(sendButton?.props.accessibilityState.disabled, true);
});

test("Captain entry read timeout releases retry without admitting a late owner response", async () => {
  const h = harness();
  h.mount();
  const stale = h.next();
  h.timeout();
  assert.equal(stale.signal.aborted, true);
  const tree = h.render();
  assert.equal(homeLink(tree), undefined);
  assert.equal(nodes(tree).find(node => node.type === "TextInput"), undefined);
  const retry = nodes(tree).find(node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق");
  assert.ok(retry, "retry must not wait for the aborted owner promise");
  retry.props.onPress();
  const fresh = h.next();
  stale.resolve(approved());
  await settle();
  assert.equal(homeLink(h.render()), undefined);
  assert.equal(nodes(h.render()).find(node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق"), undefined);
  fresh.resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), true);
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


test("Captain owner outage after verified entry blocks new login until fresh owner confirmation", async () => {
  const h = harness();
  h.mount();
  h.next().resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), true);
  h.emit("active");
  h.next().reject(new Error("owner unreachable"));
  await settle();
  const uncertain = h.render();
  assert.equal(verifiedUI(uncertain), false);
  assert.equal(homeLink(uncertain), undefined);
  assert.equal(nodes(uncertain).find(node => node.type === "TextInput"), undefined);
  const retry = nodes(uncertain).find(node => node.type === "Pressable" &&
    node.props.children?.props.children === "إعادة التحقق");
  assert.ok(retry);
  retry.props.onPress();
  h.next().resolve(approved());
  await settle();
  assert.equal(verifiedUI(h.render()), true);
  assert.ok(homeLink(h.render()));
});
