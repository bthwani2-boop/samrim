import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { previewLineSubtotalYer, summarizeCartPreview } from "../cart/cart-preview.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sourceFile = fileURLToPath(new URL("./checkout-screen.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-checkout-review-"));

let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), sourceFile,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "checkout-screen.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function flatten(tree) {
  if (tree === null || tree === undefined) return "";
  if (Array.isArray(tree)) return tree.map(flatten).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return flatten(tree.props?.children);
}

function fixture(storeId, actorId = "customer-one") {
  return {
    actorId, storeId, version: 8,
    lines: [
      { offerId: "offer-water", variantId: "variant-water", name: "ماء صنعاء",
        quantity: 2, previewUnitYer: "9007199254740993", previewAvailable: true },
      { offerId: "offer-old", variantId: "variant-old", name: "منتهي المخزون",
        quantity: 1, previewUnitYer: "1450", previewAvailable: false },
    ],
  };
}

function harness(startStore = "store-one") {
  let storeId = startStore;
  let focus;
  let cleanup;
  const hooks = [];
  let index = 0;
  const calls = [];
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
    useCallback(callback) { index++; return callback; },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const mocks = {
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
      background: "bg", surface: "surface", borderColor: "border",
      color: "text", colorSecondary: "secondary", interactiveText: "link",
      dangerText: "danger", warningText: "warning",
    } }) },
    "expo-router": {
      Link: "Link",
      useLocalSearchParams: () => ({ storeId }),
      useFocusEffect(callback) { focus = callback; },
    },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../cart/cart-preview": { previewLineSubtotalYer, summarizeCartPreview },
    "../cart/cart-transport": {
      readVerifiedCart(store, signal) {
        const call = { store, signal };
        calls.push(call);
        return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      },
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(mocks, name), ["Unexpected dependency ", name].join(""));
    return mocks[name];
  }, module, module.exports);
  function render() {
    index = 0;
    return module.exports.default();
  }
  return {
    render, get calls() { return calls; },
    focus() { cleanup = focus(); },
    blur() { cleanup?.(); },
    store(next) { storeId = next; },
  };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("Customer checkout review renders real DSH Cart, exact BigInt totals and unavailable warning", async () => {
  const h = harness();
  h.render();
  h.focus();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].store, "store-one");
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-cart-review"));

  h.calls[0].resolve({ kind: "ready", cart: fixture("store-one") });
  await settle();
  const view = h.render();
  assert.ok(nodes(view).some(n => n.props?.testID === "checkout-cart-review"));
  assert.ok(flatten(view).includes("ماء صنعاء"));
  assert.ok(flatten(view).includes("منتهي المخزون"));
  assert.match(flatten(view), /بنود غير متاحة:\s+1/);
  assert.ok(nodes(view).some(n => n.props?.testID === "checkout-preview-subtotal"));
  const exactAmount = new Intl.NumberFormat("ar-YE").format(9007199254740993n * 2n);
  assert.ok(flatten(view).includes(exactAmount), "DSH YER preview must not lose integer precision");
  assert.ok(nodes(view).some(n => n.props?.testID === "checkout-confirmation-unavailable"));
  const links = nodes(view).filter(n => n.type === "Link").map(n => n.props.href);
  assert.deepEqual(links, [{ pathname: "/cart/[storeId]", params: { storeId: "store-one" } }]);
  assert.ok(!nodes(view).some(n => n.type === "Pressable" &&
    /تأكيد|دفع|شراء/.test(flatten(n))));
  const refresh = nodes(view).find(n => n.type === "Pressable" &&
    flatten(n).includes("تحديث المراجعة"));
  assert.ok(refresh, "manual refresh re-reads the current owner");
  refresh.props.onPress();
  h.blur();
  h.render(); h.focus();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].store, "store-one");
});

test("Changing Store aborts old DSH read, hides other Store data and accepts only current result", async () => {
  const h = harness("store-a");
  h.render(); h.focus();
  const old = h.calls[0];
  h.blur();
  h.store("store-b");
  h.render(); h.focus();
  assert.equal(h.calls.length, 2);
  assert.equal(old.signal.aborted, true);
  old.resolve({ kind: "ready", cart: fixture("store-a") });
  await settle();
  assert.ok(!flatten(h.render()).includes("ماء صنعاء"));

  h.calls[1].resolve({ kind: "ready", cart: fixture("store-b") });
  await settle();
  assert.ok(flatten(h.render()).includes("ماء صنعاء"));
  h.blur();
});

test("Signed-out, owner failure, cross-Store and missing identifier never show private cart", async () => {
  const h = harness("store-one");
  h.render(); h.focus();
  h.calls[0].resolve({ kind: "signed-out" });
  await settle();
  assert.ok(flatten(h.render()).includes("سجل الدخول"));
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-cart-review"));
  h.blur();
  h.store("not/valid");
  h.render(); h.focus();
  assert.equal(h.calls.length, 1, "malformed Store cannot trigger a DSH call");
  h.blur();
  h.store("store-two");
  h.render(); h.focus();
  const request = h.calls[1];
  request.resolve({ kind: "ready", cart: fixture("unrelated-store") });
  await settle();
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-cart-review"));
  h.blur();
  h.render(); h.focus();
  h.calls[2].reject(new Error("DSH offline"));
  await settle();
  assert.ok(flatten(h.render()).includes("تعذر التحقق"));
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-cart-review"));
});
