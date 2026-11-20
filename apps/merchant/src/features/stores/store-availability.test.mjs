import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../../../..");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-availability-"));
let compiled;
try {
  const task = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(import.meta.dirname, "store-availability.tsx"), "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(task.status, 0, task.stderr || task.stdout);
  compiled = readFileSync(path.join(temp, "store-availability.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function harness() {
  const hooks = [];
  const effects = [];
  const reads = [];
  const writes = [];
  let index = 0;
  let operationSequence = 0;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
      },
      useEffect(fn, deps) {
        const at = index++;
        if (hooks[at]?.deps.every((value, i) => Object.is(value, deps[i]))) return;
        effects.push(() => { hooks[at]?.cleanup?.(); hooks[at] = { deps, cleanup: fn() }; });
      },
      useRef(initial) {
        const at = index++;
        return hooks[at] ??= { current: initial };
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "Loading", Pressable: "Button", Text: "Text", TextInput: "Input", View: "View" },
    "expo-crypto": { randomUUID: () => `synthetic-operation-${++operationSequence}` },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "../access/admission-transport": {
      readMerchantAvailability(storeId, signal) {
        return new Promise((resolve, reject) => reads.push({ storeId, signal, resolve, reject }));
      },
      saveMerchantAvailability(storeId, actorId, change, signal) {
        return new Promise((resolve, reject) => writes.push({ storeId, actorId, change, signal, resolve, reject }));
      },
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`);
    return modules[name];
  }, mod, mod.exports);
  return {
    render(storeId, actorId) {
      index = 0;
      effects.length = 0;
      const view = mod.exports.default({ storeId, actorId });
      effects.forEach(fn => { fn(); });
      return view;
    },
    read() { assert.ok(reads.length, "a selected Store must trigger a fresh read"); return reads.shift(); },
    writes,
    count: () => reads.length,
    unmount() { hooks.forEach(hook => { hook?.cleanup?.(); }); },
  };
}
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const byID = (node, id) => find(node, item => item.props?.testID === id);
function content(node) {
  if (Array.isArray(node)) return node.map(content).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  return typeof node === "object" ? content(node.props?.children) : String(node);
}
const snapshot = {
  storeId: "store-a", timezone: "Asia/Aden", weekly: [{ weekday: 1, opens: 1320, closes: 120 }],
  preparationMinutes: 15, version: 3, actingActorId: "merchant-a", reason: "جدول معتمد",
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("no Store context triggers no private read", () => {
  const h = harness();
  assert.match(content(h.render()), /اختر متجرًا/);
  assert.equal(h.count(), 0);
});

test("Merchant reads actual Store hours, overnight time, timezone and version", async () => {
  const h = harness();
  assert.equal(byID(h.render("store-a"), "merchant-availability-snapshot"), undefined);
  h.read().resolve(snapshot);
  await settle();
  const view = h.render("store-a");
  assert.ok(byID(view, "merchant-availability-snapshot"));
  for (const expected of ["Asia/Aden", "22:00", "02:00", "اليوم التالي", "15", "3", "جدول معتمد"]) {
    assert.ok(content(view).includes(expected), expected);
  }
});

for (const [weekly, expected] of [[null, "لم يُحدد جدول أسبوعي"], [[], "مغلق طوال الأسبوع"]]) {
  test(`Store schedule distinguishes ${expected}`, async () => {
    const h = harness(); h.render("store-a"); h.read().resolve({ ...snapshot, weekly }); await settle();
    assert.ok(content(h.render("store-a")).includes(expected));
  });
}

test("switching Store conceals prior data and aborts late responses", async () => {
  const h = harness(); h.render("store-a");
  const old = h.read();
  const changed = h.render("store-b");
  assert.equal(old.signal.aborted, true);
  assert.equal(byID(changed, "merchant-availability-snapshot"), undefined);
  old.resolve(snapshot); await settle();
  assert.equal(byID(h.render("store-b"), "merchant-availability-snapshot"), undefined);
  h.read().resolve({ ...snapshot, storeId: "store-b", reason: "متجر ب" }); await settle();
  const view = h.render("store-b");
  assert.ok(content(view).includes("متجر ب"));
  assert.equal(content(view).includes(snapshot.reason), false);
});

test("temporary pause uses the Store timezone rather than the device's timezone or raw UTC", async () => {
  const h = harness(); h.render("store-a");
  h.read().resolve({ ...snapshot, pausedUntil: "2026-11-19T12:00:00Z" }); await settle();
  const text = content(h.render("store-a"));
  assert.ok(text.includes("15:00"), "Asia/Aden is three hours ahead of UTC");
  assert.equal(text.includes("12:00:00Z"), false);
});

for (const status of [401, 403, 503]) {
  test(`Store ${status} clears the snapshot and allows explicit retry`, async () => {
    const h = harness(); h.render("store-a");
    h.read().resolve(snapshot); await settle();
    let view = h.render("store-a");
    const refresh = () => find(view, node => node.props?.accessibilityLabel === "تحديث إتاحة المتجر").props.onPress();
    refresh(); h.render("store-a");
    h.read().reject({ status }); await settle();
    view = h.render("store-a");
    assert.equal(byID(view, "merchant-availability-snapshot"), undefined);
    assert.ok(byID(view, "merchant-availability-error"));
    assert.ok(content(view).includes(status === 503 ? "تعذّر تأكيد" : "لا تتوفر صلاحية"));
    refresh(); h.render("store-a"); h.read().resolve(snapshot); await settle();
    view = h.render("store-a");
    assert.ok(byID(view, "merchant-availability-snapshot"));
    assert.equal(byID(view, "merchant-availability-error"), undefined);
  });
}

test("unmount cancels a private Store read", () => {
  const h = harness(); h.render("store-a"); const read = h.read();
  h.unmount(); assert.equal(read.signal.aborted, true);
});

test("pausing preserves the owner schedule and reconciles an ambiguous write using the same command", async () => {
  const h = harness();
  const render = () => h.render("store-a", "merchant-a");
  const button = view => find(view, item => item.type === "Button" && item.props.accessibilityState);
  render(); h.read().resolve(snapshot); await settle();
  let view = render();
  find(view, item => item.props?.accessibilityLabel === "مدة الإيقاف بالدقائق").props.onChangeText("٣٠");
  find(view, item => item.props?.accessibilityLabel === "سبب التغيير").props.onChangeText("ازدحام مؤقت");
  view = render();
  assert.equal(button(view).props.disabled, false);
  const first = button(view).props.onPress();
  await button(view).props.onPress();
  assert.equal(h.writes.length, 1);
  const attempt = h.writes.shift();
  assert.equal(attempt.actorId, "merchant-a");
  assert.equal(attempt.change.expectedVersion, snapshot.version);
  assert.deepEqual(attempt.change.weekly, snapshot.weekly);
  assert.equal(attempt.change.preparationMinutes, snapshot.preparationMinutes);
  assert.equal(attempt.change.reason, "ازدحام مؤقت");
  assert.ok(Date.parse(attempt.change.pausedUntil) > Date.now());
  attempt.reject({ status: 503 });
  await first;
  assert.match(content(render()), /إعادة التحقق من الحفظ/);
  const recovery = button(render()).props.onPress();
  const replay = h.writes.shift();
  assert.deepEqual(replay.change, attempt.change);
  replay.resolve();
  await recovery;
  assert.equal(byID(render(), "merchant-availability-snapshot"), undefined);
  h.read().resolve({ ...snapshot, version: 4, pausedUntil: attempt.change.pausedUntil });
  await settle();
  view = render();
  assert.match(content(view), /إنهاء الإيقاف المؤقت/);
  find(view, item => item.props?.accessibilityLabel === "سبب التغيير").props.onChangeText("عاد التشغيل");
  const resume = button(render()).props.onPress();
  const resumeAttempt = h.writes.shift();
  assert.equal(resumeAttempt.change.expectedVersion, 4);
  assert.equal(resumeAttempt.change.pausedUntil, null);
  render();
  h.unmount();
  assert.equal(resumeAttempt.signal.aborted, true);
  resumeAttempt.resolve();
  await resume;
  assert.equal(h.count(), 0);
});

test("a new Store saves multiple explicit periods with overnight and Arabic inputs", async () => {
  const h = harness();
  const render = () => h.render("store-a", "merchant-a");
  const button = (label) => find(render(), item => item.type === "Button" && content(item) === label);
  const input = (label, value) => find(render(), item => item.props?.accessibilityLabel === label).props.onChangeText(value);
  const initial = { ...snapshot, weekly: null, version: 1, preparationMinutes: 0, reason: "" };
  render(); h.read().resolve(initial); await settle();
  button("إعداد الدوام").props.onPress();
  input("مدة التجهيز بالدقائق", "١٥");
  input("سبب التغيير", "إعداد دوام المتجر");
  assert.equal(button("حفظ الدوام والتجهيز").props.disabled, true, "no implicit closure");
  const add = () => find(render(), item => item.props?.accessibilityLabel === "إضافة فترة يوم الجمعة").props.onPress();
  add();
  input("وقت الفتح يوم الجمعة للفترة 1", "٠٩:٠٠");
  input("وقت الإغلاق يوم الجمعة للفترة 1", "١٢:٠٠");
  add();
  input("وقت الفتح يوم الجمعة للفترة 2", "٢٢:٣٠");
  input("وقت الإغلاق يوم الجمعة للفترة 2", "٢٥:٠٠");
  assert.equal(button("حفظ الدوام والتجهيز").props.disabled, true, "invalid time");
  input("وقت الإغلاق يوم الجمعة للفترة 2", "٠١:٣٠");
  const first = button("حفظ الدوام والتجهيز").props.onPress();
  const command = h.writes.shift();
  assert.deepEqual(command.change.weekly, [{ weekday: 5, opens: 540, closes: 720 },
    { weekday: 5, opens: 1350, closes: 90 }]);
  assert.equal(command.change.preparationMinutes, 15);
  assert.equal(command.change.pausedUntil, null);
  assert.equal(command.change.expectedVersion, 1);
  command.reject({ status: 409 });
  await first;
  render();
  h.read().resolve({ ...snapshot, version: 2 }); await settle();
  assert.match(content(render()), /تغيّر سجل الإتاحة/);
  assert.ok(button("تعديل الدوام والتجهيز"), "reconciles latest version before editing again");
});
