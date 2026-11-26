import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
    path.join(root, "node_modules/typescript/bin/tsc"), ...sources.map(source => path.join(captain, `${source}.tsx`)),
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
    node.props.children.includes("3")));
  assert.ok(dashboard.some(node => node.props.children?.includes?.("مهام التوصيل")));
  assert.deepEqual(dashboard.filter(node => node.type === "Link"), []);
  workspace = null;
  assert.equal(home(), null, "private Home does not render outside verified workspace");
  const guardedOffers = offers();
  assert.equal(guardedOffers.type, "CaptainProtectedRoute");
  const offerLinks = nodes(screen(guardedOffers.props.children.props)).filter(node => node.type === "Link");
  assert.deepEqual(offerLinks.map(node => node.props.href), ["/home"]);
});

test("Captain account renders verified session and can request owner logout", () => {
  let workspace = null;
  let requested = false;
  const account = renderable("app/(tabs)/account", {
    "../../src/features/access/protected-route": { useCaptainWorkspace: () => workspace },
  });
  assert.equal(account(), null);
  workspace = {
    session: { actorId: "synthetic-captain", role: "captain", sessionExpiresAt: "2026-11-21T12:00:00Z" },
    standing: { actorId: "synthetic-captain", status: "APPROVED", version: 3 },
    signOut() { requested = true; },
  };
  const view = account();
  assert.equal(view.type, "SafeAreaView");
  assert.deepEqual(view.props.edges, ["top", "left", "right"]);
  const content = nodes(view);
  assert.ok(content.some(node => node.props.children === "حساب الكابتن معتمد"));
  assert.equal(content.some(node => node.props.testID === "captain-capability-unavailable"), false);
  content.find(node => node.type === "Pressable" && node.props.accessibilityRole === "button").props.onPress();
  assert.equal(requested, true);
});

test("Captain interest leaves definite rejection retryable but stops after receipt or unknown outcome", async () => {
  class DshPublicError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  const savedOrigin = process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN;
  process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN = "https://dsh.example";
  try {
    for (const finalError of [new DshPublicError(0, "OPERATION_RESULT_UNKNOWN"), null]) {
      const hooks = [];
      const requests = [];
      let nextHook = 0;
      let rejectFirst;
      const screen = renderable("src/features/join/captain-interest-screen", {
        react: {
          useState(initial) {
            const index = nextHook++;
            if (!(index in hooks)) hooks[index] = initial;
            return [hooks[index], value => { hooks[index] = value; }];
          },
          useRef(initial) {
            const index = nextHook++;
            hooks[index] ??= { current: initial };
            return hooks[index];
          },
          useEffect() {},
        },
        "react-native": { Text: "Text", View: "View", ScrollView: "ScrollView", Pressable: "Pressable", TextInput: "TextInput" },
        "@bthwani/dsh": {
          DshPublicError,
          validCaptainInterest: input => Boolean(input.name) && /^(?:\+967)?7\d{8}$/.test(input.phone),
          submitCaptainInterest: async (_origin, input) => {
            requests.push(input);
            if (requests.length === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
            if (finalError) throw finalError;
          },
        },
      });
      const render = () => {
        nextHook = 0;
        return nodes(screen());
      };
      const findSubmit = view => view.find(node => node.props.accessibilityRole === "button");
      const typedPhone = finalError ? "٧٧٠١٢٣٤٥٦" : "+۹۶۷۷۷۰۱۲۳۴۵۶";
      const wirePhone = finalError ? "770123456" : "+967770123456";
      const field = (view, label) => view.find(node => node.props.accessibilityLabel === label);
      field(render(), "الاسم الكامل").props.onChangeText("اسم تجريبي");
      field(render(), "رقم الهاتف").props.onChangeText(typedPhone);
      const radios = () => render().filter(node => node.props.accessibilityRole === "radio");
      radios()[4].props.onPress();
      radios().at(-2).props.onPress();
      field(render(), "تفاصيل الخبرة").props.onChangeText("خبرة تجريبية");
      radios()[0].props.onPress();
      radios().at(-2).props.onPress();
      assert.deepEqual([
        radios()[4].props.accessibilityState.selected,
        field(render(), "تفاصيل الخبرة").props.value,
      ], [true, "خبرة تجريبية"], "reselecting the same choices must preserve the entered facts");
      radios()[1].props.onPress();
      assert.equal(radios()[4].props.accessibilityState.selected, false, "changing vehicle clears the old plate choice");
      radios()[4].props.onPress();
      radios().at(-1).props.onPress();
      assert.equal(field(render(), "تفاصيل الخبرة"), undefined);
      radios().at(-2).props.onPress();
      assert.equal(field(render(), "تفاصيل الخبرة").props.value, "", "changing experience clears obsolete details");
      field(render(), "تفاصيل الخبرة").props.onChangeText("خبرة تجريبية");
      const submit = findSubmit(render());
      assert.equal(submit.props.disabled, false, "Arabic digit input must enable a valid registration");
      const beforeRadios = render().filter(node => node.props.accessibilityRole === "radio");
      const selected = beforeRadios.map(node => node.props.accessibilityState.selected);
      submit.props.onPress();
      const pending = render().filter(node => node.props.accessibilityRole === "radio");
      assert.ok(pending.length > 0);
      assert.ok(pending.every(node => node.props.disabled && node.props.accessibilityState.disabled),
        "all choices must be disabled while submission is pending");
      for (const radio of beforeRadios) {
        if (!radio.props.accessibilityState.selected) radio.props.onPress();
      }
      rejectFirst(new DshPublicError(429, "RATE_LIMITED"));
      await new Promise(setImmediate);
      const afterRejection = render();
      const recovered = afterRejection.filter(node => node.props.accessibilityRole === "radio");
      assert.deepEqual(recovered.map(node => node.props.accessibilityState.selected), selected);
      assert.ok(recovered.every(node => !node.props.disabled));
      assert.match(afterRejection.find(node => node.props.accessibilityRole === "alert").props.children, /تجاوز عدد المحاولات/);
      assert.equal(findSubmit(afterRejection).props.disabled, false);
      assert.equal(afterRejection.find(node => node.props.accessibilityLabel === "الاسم الكامل").props.value, "اسم تجريبي");
      assert.equal(field(afterRejection, "رقم الهاتف").props.value, typedPhone);
      findSubmit(afterRejection).props.onPress();
      await Promise.resolve();
      const afterFinal = render();
      assert.equal(findSubmit(afterFinal), undefined, "the screen must not offer another submission after the result");
      assert.equal(requests.length, 2);
      submit.props.onPress();
      await new Promise(setImmediate);
      assert.equal(requests.length, 2, "a retained submit callback cannot repeat a terminal intake");
      assert.deepEqual(requests.map(input => input.phone), [wirePhone, wirePhone]);
      assert.ok(afterFinal.some(node => node.type === "Link" && node.props.href === "/"));
      const notice = afterFinal.find(node => node.props.accessibilityRole === "alert");
      assert.equal(notice.props.testID, finalError ? "captain-interest-uncertain" : "captain-interest-received");
      assert.match(notice.props.children, finalError ? /تعذّر تأكيد/ : /تم استلام بياناتك/);
    }
  } finally {
    if (savedOrigin === undefined) delete process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN;
    else process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN = savedOrigin;
  }
});
