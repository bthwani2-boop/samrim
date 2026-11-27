import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validCaptainInterest } from "../../../services/dsh/clients/captain-interest.ts";
import { DshPublicError } from "../../../services/dsh/clients/client-core.ts";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const captain = path.join(root, "apps/captain");
const sources = ["src/components/captain-capability-screen",
  "src/features/dispatch/captain-home-screen", "src/features/join/captain-interest-screen",
  "app/(tabs)/account", "app/offers"];
const temporary = mkdtempSync(path.join(tmpdir(), "bthwani-captain-guest-navigation-"));
const compiled = new Map();
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/@typescript/native/bin/tsc"), ...sources.map(source => path.join(captain, `${source}.tsx`)),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources",
    "--rootDir", captain, "--outDir", temporary,
  ], { cwd: root, timeout: 20_000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const source of sources) compiled.set(source, readFileSync(path.join(temporary, `${source}.js`), "utf8"));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function renderable(source, dependencies = {}) {
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useRef: current => ({ current }), useState: initial => [initial, () => undefined] },
    "react-native": { Text: "Text", View: "View", ScrollView: "ScrollView", Pressable: "Pressable" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { Link: "Link" },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    ...dependencies,
  };
  return loadMappedRenderFixture(compiled.get(source), path.join(captain, `${source}.tsx`), mocks).exports.default;
}
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("Captain workspace separates verified access from unavailable data and keeps real return links", () => {
  const screen = renderable("src/components/captain-capability-screen");
  const screenModule = { __esModule: true, default: screen };
  let workspace = {
    session: { actorId: "synthetic-captain", role: "captain",
      sessionExpiresAt: "2099-11-22T19:10:00Z" },
    standing: { actorId: "synthetic-captain", status: "APPROVED", version: 3 },
  };
  const home = renderable("src/features/dispatch/captain-home-screen", {
    "../access/protected-route": { useCaptainWorkspace: () => workspace },
  });
  const offers = renderable("app/offers", {
    "../src/components/captain-capability-screen": screenModule,
    "../src/features/access/protected-route": { __esModule: true, default: "CaptainProtectedRoute" },
  });
  const dashboard = nodes(home());
  assert.ok(dashboard.some(node => node.props.testID === "captain-standing-verified" &&
    node.props.children === "حساب الكابتن معتمد"));
  assert.ok(dashboard.some(node => node.props.children?.includes?.("مهام التوصيل")));
  assert.deepEqual(dashboard.filter(node => node.type === "Link"), []);
  workspace = null;
  assert.equal(home(), null, "private Home does not render outside verified workspace");
  const guardedOffers = offers();
  assert.equal(guardedOffers.type, "CaptainProtectedRoute");
  const offerLinks = nodes(screen(guardedOffers.props.children.props)).filter(node => node.type === "Link");
  assert.deepEqual(offerLinks.map(node => node.props.href), ["/home"]);
});

test("Captain account admits only its verified workspace, delegates appearance and requests owner logout", () => {
  let workspace = null;
  let requests = 0;
  const account = renderable("app/(tabs)/account", {
    "@bthwani/tamagui-config/appearance-preferences": { __esModule: true, default: "AppearancePreferences" },
    "../../src/features/access/protected-route": { useCaptainWorkspace: () => workspace },
  });
  assert.equal(account(), null);
  const session = { actorId: "synthetic-captain", role: "captain", sessionExpiresAt: "2099-11-22T19:10:00Z" };
  const standing = { actorId: session.actorId, status: "APPROVED", version: 3 };
  workspace = { session, standing, signOut() { requests++; } };
  const view = account();
  assert.equal(view.type, "SafeAreaView");
  assert.deepEqual(view.props.edges, ["top", "left", "right"]);
  const content = nodes(view);
  assert.ok(content.some(node => node.props.children === "حساب الكابتن معتمد"));
  assert.equal(content.filter(node => node.type === "AppearancePreferences").length, 1);
  assert.equal(content.some(node => node.props.testID === "captain-capability-unavailable"), false);
  const signOut = content.find(node => node.type === "Pressable" && node.props.accessibilityRole === "button");
  assert.ok(signOut);
  signOut.props.onPress();
  assert.equal(requests, 1);
  for (const invalid of [undefined, { ...standing, actorId: "other" },
    { ...standing, status: "PENDING" }, { ...standing, version: 0 }, { ...standing, version: 1.5 }]) {
    workspace = { session, standing: invalid, signOut() { requests++; } };
    const rejected = nodes(account());
    assert.ok(!rejected.some(node => node.props.children === "حساب الكابتن معتمد"));
    assert.ok(rejected.some(node => node.props.accessibilityRole === "alert"));
  }
  assert.equal(requests, 1);
});

// The renderer is isolated from React Native, but uses the real DSH input
// validator and error type. Transport outcomes are explicitly controlled here;
// these tests do not claim a real HTTP receipt or Android journey.
function guestIntake(origin = "https://dsh.example") {
  const previous = process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN;
  const hooks = [];
  const requests = [];
  let nextHook = 0;
  let cleanup;
  let writes = 0;
  if (origin === null) delete process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN;
  else process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN = origin;
  let screen;
  try {
    screen = renderable("src/features/join/captain-interest-screen", {
      react: {
        useState(initial) {
          const index = nextHook++;
          if (!(index in hooks)) hooks[index] = initial;
          return [hooks[index], value => { writes++; hooks[index] = value; }];
        },
        useRef(initial) {
          const index = nextHook++;
          hooks[index] ??= { current: initial };
          return hooks[index];
        },
        useEffect(effect) { cleanup ??= effect(); },
      },
      "react-native": { Text: "Text", View: "View", ScrollView: "ScrollView", Pressable: "Pressable", TextInput: "TextInput" },
      "@bthwani/dsh": {
        DshPublicError,
        validCaptainInterest,
        submitCaptainInterest: (base, input, signal) => new Promise((resolve, reject) => {
          requests.push({ base, input, signal, resolve, reject });
        }),
      },
    });
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN;
    else process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN = previous;
  }
  const render = () => { nextHook = 0; return nodes(screen()); };
  const field = label => render().find(node => node.type === "TextInput" && node.props.accessibilityLabel === label);
  const enter = (label, value) => field(label).props.onChangeText(value);
  const groups = () => render().filter(node => node.props.accessibilityRole === "radiogroup");
  const radios = label => nodes(groups().find(group => group.props.accessibilityLabel === label))
    .filter(node => node.props.accessibilityRole === "radio");
  const choose = (group, label) => radios(group).find(radio => radio.props.accessibilityLabel === label).props.onPress();
  const submit = () => render().find(node => node.props.accessibilityRole === "button");
  const notice = () => render().find(node => node.props.accessibilityRole === "alert");
  const fill = phone => {
    enter("الاسم الكامل", "اسم تجريبي");
    enter("رقم الهاتف", phone);
    enter("المدينة", "صنعاء");
    enter("الحي أو منطقة السكن", "الوحدة");
  };
  return { render, field, enter, groups, radios, choose, submit, notice, fill, requests,
    unmount: () => cleanup(), writes: () => writes };
}

const vehicleGroup = "نوع الدراجة";
const plateGroup = "هل الدراجة مرقمة؟";
const experienceGroup = "هل لديك خبرة سابقة بالتوصيل؟";
const settle = () => new Promise(setImmediate);

test("Captain intake requires owner-valid facts and exposes one checked state per choice group", async () => {
  const form = guestIntake();
  assert.equal(form.submit().props.disabled, true);
  form.fill("٧٧٠١٢٣٤٥٦");
  assert.equal(form.submit().props.disabled, true, "owner requires an explicit plate answer");
  const groups = form.groups();
  assert.equal(groups.length, 4);
  assert.equal(new Set(groups.map(group => group.props.accessibilityLabel)).size, 4);
  assert.deepEqual(groups.map(group => nodes(group).filter(node => node.props.accessibilityRole === "radio" && node.props.accessibilityState.checked).length), [1, 0, 1, 1]);
  for (const group of groups) {
    for (const radio of nodes(group).filter(node => node.props.accessibilityRole === "radio")) {
      assert.equal(typeof radio.props.accessibilityState.checked, "boolean");
      assert.equal(radio.props["aria-checked"], radio.props.accessibilityState.checked);
      assert.equal(typeof radio.props.accessibilityLabel, "string");
      assert.equal(Object.hasOwn(radio.props.accessibilityState, "selected"), false);
    }
  }
  form.choose(plateGroup, "نعم");
  form.choose(experienceGroup, "نعم");
  form.enter("تفاصيل الخبرة", "خبرة تجريبية");
  form.choose(vehicleGroup, "دراجة نارية");
  form.choose(experienceGroup, "نعم");
  assert.equal(form.radios(plateGroup)[0].props.accessibilityState.checked, true);
  assert.equal(form.field("تفاصيل الخبرة").props.value, "خبرة تجريبية");
  form.choose(vehicleGroup, "دراجة كهربائية");
  assert.equal(form.submit().props.disabled, true);
  form.choose(plateGroup, "لا");
  form.choose(experienceGroup, "لا");
  assert.equal(form.field("تفاصيل الخبرة"), undefined);
  form.choose(experienceGroup, "نعم");
  assert.equal(form.field("تفاصيل الخبرة").props.value, "");
  form.choose(vehicleGroup, "دراجة هوائية");
  assert.equal(form.radios(plateGroup).length, 0);
  assert.equal(form.submit().props.disabled, false);
  form.submit().props.onPress();
  assert.deepEqual(form.requests[0].input, {
    name: "اسم تجريبي", phone: "770123456", city: "صنعاء", district: "الوحدة",
    vehicleType: "BICYCLE", phoneType: "SMART", experienced: true,
  });
  form.requests[0].resolve();
  await settle();
  assert.equal(form.notice().props.testID, "captain-interest-received");
});

test("Captain intake serializes pending input, retries definite rejection and stops on receipt or uncertainty", async () => {
  for (const finalError of [new DshPublicError(0, "OPERATION_RESULT_UNKNOWN"), null]) {
    const form = guestIntake();
    const typedPhone = finalError ? "٧٧٠١٢٣٤٥٦" : "+۹۶۷۷۷۰۱۲۳۴۵۶";
    const wirePhone = finalError ? "770123456" : "+967770123456";
    form.fill(typedPhone);
    form.choose(plateGroup, "نعم");
    form.choose(experienceGroup, "نعم");
    form.enter("تفاصيل الخبرة", "خبرة تجريبية");
    const send = form.submit();
    const staleField = form.field("الاسم الكامل");
    const beforeRadios = form.render().filter(node => node.props.accessibilityRole === "radio");
    const selected = beforeRadios.map(node => node.props.accessibilityState.checked);
    send.props.onPress();
    send.props.onPress();
    assert.equal(form.requests.length, 1);
    assert.equal(form.submit().props.accessibilityState.busy, true);
    assert.equal(form.field("الاسم الكامل").props.editable, false);
    staleField.props.onChangeText("اسم غير مقبول");
    const pending = form.render().filter(node => node.props.accessibilityRole === "radio");
    assert.ok(pending.every(node => node.props.disabled && node.props.accessibilityState.disabled));
    for (const radio of beforeRadios) {
      if (!radio.props.accessibilityState.checked) radio.props.onPress();
    }
    form.requests[0].reject(new DshPublicError(429, "RATE_LIMITED"));
    await settle();
    assert.deepEqual(form.render().filter(node => node.props.accessibilityRole === "radio")
      .map(node => node.props.accessibilityState.checked), selected);
    assert.match(form.notice().props.children, /تجاوز عدد المحاولات/);
    assert.equal(form.field("الاسم الكامل").props.value, "اسم تجريبي");
    assert.equal(form.field("رقم الهاتف").props.value, typedPhone);
    assert.equal(form.submit().props.disabled, false);
    form.submit().props.onPress();
    form.requests[1].reject(new DshPublicError(400, "INVALID_REQUEST"));
    await settle();
    assert.match(form.notice().props.children, /تعذّر إرسال البيانات/);
    assert.equal(form.submit().props.disabled, false);
    form.submit().props.onPress();
    if (finalError) form.requests[2].reject(finalError);
    else form.requests[2].resolve();
    await settle();
    assert.equal(form.submit(), undefined);
    send.props.onPress();
    await settle();
    assert.equal(form.requests.length, 3);
    assert.deepEqual(form.requests.map(request => request.input.phone), [wirePhone, wirePhone, wirePhone]);
    assert.ok(form.render().some(node => node.type === "Link" && node.props.href === "/"));
    assert.equal(form.notice().props.testID, finalError ? "captain-interest-uncertain" : "captain-interest-received");
  }
});

test("Captain intake denies unconfigured transport and aborts both late success and late rejection on exit", async () => {
  const disabled = guestIntake(null);
  disabled.fill("770123456");
  disabled.choose(plateGroup, "نعم");
  assert.equal(disabled.submit().props.disabled, true);
  assert.ok(disabled.render().some(node => node.props.children === "استمارة التسجيل غير متاحة في هذه البيئة حاليًا."));
  disabled.submit().props.onPress();
  disabled.unmount();
  assert.equal(disabled.requests.length, 0);
  for (const failure of [false, true]) {
    const form = guestIntake();
    form.fill("770123456");
    form.choose(plateGroup, "نعم");
    form.submit().props.onPress();
    const request = form.requests[0];
    assert.equal(request.base, "https://dsh.example");
    assert.equal(request.signal.aborted, false);
    const before = form.writes();
    form.unmount();
    assert.equal(request.signal.aborted, true);
    if (failure) request.reject(new DshPublicError(0, "OPERATION_RESULT_UNKNOWN"));
    else request.resolve();
    await settle();
    assert.equal(form.writes(), before, "abandoned request must never publish state");
    assert.equal(form.requests.length, 1);
  }
});
