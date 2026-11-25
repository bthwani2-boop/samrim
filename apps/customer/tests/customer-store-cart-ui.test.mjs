import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshCartError } from "@bthwani/dsh";
import { formatExactYer } from "../src/components/format-exact-yer.ts";
import { previewLineSubtotalYer, summarizeCartPreview } from "../src/features/cart/cart-preview.ts";
import { pendingCartChange, withPendingCartChange } from "../src/features/cart/cart-session.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = path.join(root, "apps/customer/src/features");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-store-cart-"));
const files = ["cart/use-store-cart", "catalog/store-products", "catalog/product-detail", "cart/cart-screen"];
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(source, "cart/use-store-cart.ts"), ...files.slice(1).map(file => path.join(source, `${file}.tsx`)),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx",
    "--rootDir", source, "--outDir", temp], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = files.map(file => readFileSync(path.join(temp, `${file}.js`), "utf8"));
} finally { rmSync(temp, { recursive: true, force: true }); }

const jsx = (type, props) => ({ type, props });
const modules = {
  "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
  "@bthwani/dsh": { DshCartError },
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
  "./cart-session": { pendingCartChange },
  "./product-detail": { default: "ProductDetail" },
  "./product-variants": { default: "ProductVariantPrice" },
  "../../components/format-exact-yer": { formatExactYer },
  "../cart/cart-preview": { summarizeCartPreview },
};
function load(sourceCode, overrides = {}) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", sourceCode)(key => {
    const module = overrides[key] ?? modules[key];
    assert.ok(module, `unexpected import ${key}`);
    return module;
  }, mod, mod.exports);
  return mod.exports;
}

const store = { id: "store-a", orderabilityStatus: "OPERATIONALLY_UNAVAILABLE" };
const offer = { id: "water", storeId: store.id, variantId: "water-v", name: "ماء", available: true, priceYer: 150 };
const ownerLine = { offerId: offer.id, variantId: offer.variantId, quantity: 1, previewUnitYer: "175", previewAvailable: true };
const emptyCart = { actorId: "customer-a", storeId: store.id, version: 4, lines: [] };
const settle = () => new Promise(setImmediate);

test("first tap sends quantity one, shows only the owner-confirmed result, and minus removes the last item", async () => {
  const hooks = [];
  const writes = [];
  let index = 0;
  let generated = 0;
  let start;
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useRef(initial) {
      const at = index++;
      hooks[at] ??= { current: initial };
      return hooks[at];
    },
    useCallback(callback) { return callback; },
    useEffect() {},
  };
  const { useStoreCart } = load(compiled[0], {
    react,
    "expo-crypto": { randomUUID: () => `test-operation-${++generated}` },
    "react-native": { Platform: { OS: "android" }, AppState: { addEventListener() { return { remove() {} }; } } },
    "expo-router": { useFocusEffect(callback) { start = callback; } },
    "./cart-transport": {
      readVerifiedCart: async () => ({ kind: "ready", cart: emptyCart }),
      replaceVerifiedCart: (storeId, change, actorId) => withPendingCartChange(actorId, storeId, change,
        original => new Promise((resolve, reject) => writes.push({ original, resolve, reject }))),
    },
  });
  function render() {
    index = 0;
    // biome-ignore lint/correctness/useHookAtTopLevel: This fixture runs the hook under an ordered mock React renderer.
    return useStoreCart(store.id);
  }
  render();
  const cleanup = start();
  try {
    await settle();
    render().adjust(offer, 1);
    render().adjust(offer, 1);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].original.lines, [{ offerId: offer.id, quantity: 1 }]);
    assert.equal(writes[0].original.expectedVersion, 4);
    assert.deepEqual(render().cart.lines, []);

    writes[0].reject(new DshCartError(0, "OPERATION_RESULT_UNKNOWN"));
    await settle();
    assert.equal(render().pending, true);
    assert.deepEqual(render().cart.lines, []);
    render().confirm();
    assert.equal(writes[1].original, writes[0].original);
    writes[1].resolve({ cart: { ...emptyCart, version: 5, lines: [ownerLine] }, replay: true });
    await settle();
    assert.deepEqual(render().cart.lines, [ownerLine]);

    render().adjust(offer, 1);
    assert.equal(writes[2].original.expectedVersion, 5);
    assert.deepEqual(writes[2].original.lines, [{ offerId: offer.id, quantity: 2 }]);
    assert.notEqual(writes[2].original.operationId, writes[0].original.operationId);
    writes[2].resolve({ cart: { ...emptyCart, version: 6, lines: [{ ...ownerLine, quantity: 2 }] }, replay: false });
    await settle();

    render().adjust(offer, -1);
    assert.deepEqual(writes[3].original.lines, [{ offerId: offer.id, quantity: 1 }]);
    writes[3].resolve({ cart: { ...emptyCart, version: 7, lines: [ownerLine] }, replay: false });
    await settle();

    render().adjust(offer, -1);
    assert.equal(writes[4].original.expectedVersion, 7);
    assert.deepEqual(writes[4].original.lines, []);
    writes[4].resolve({ cart: { ...emptyCart, version: 8 }, replay: false });
    await settle();
    assert.deepEqual(render().cart.lines, []);
  } finally { cleanup(); }
});

function cartScreenHarness() {
  const hooks = [], effects = new Map(), deps = new Map(), cleanups = new Map();
  const reads = [], estimates = [], writes = [];
  let index = 0, focus, resume;
  const deferred = (calls, signal) => new Promise(resolve => calls.push({ signal, resolve }));
  const { default: CartScreen } = load(compiled[3], {
    react: {
      useState(initial) { const at = index++; if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }]; },
      useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
      useCallback(callback) { return callback; },
      useEffect(effect, next) { const at = index++; const old = deps.get(at);
        if (!old || next.some((value, i) => value !== old[i])) { deps.set(at, next); effects.set(at, effect); } },
    },
    "expo-router": { Link: "Link", useLocalSearchParams: () => ({ storeId: "store-a" }), useFocusEffect(callback) { focus = callback; } },
    "expo-crypto": { randomUUID: () => "test-cart-command" },
    "react-native": { AppState: { addEventListener(_event, callback) { resume = callback; return { remove() {} }; } },
      Platform: { OS: "android" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./cart-preview": { previewLineSubtotalYer, summarizeCartPreview },
    "./cart-transport": {
      readVerifiedCart: (_storeId, signal) => deferred(reads, signal),
      readVerifiedCartMerchandiseEstimate: (_storeId, _version, _actor, signal) => deferred(estimates, signal),
      replaceVerifiedCart: (storeId, change, actorId, signal) => withPendingCartChange(actorId, storeId, change,
        original => new Promise((resolve, reject) => writes.push({ storeId, actorId, signal, original, resolve, reject }))),
    },
  });
  return {
    reads, estimates, writes,
    render() { index = 0; const tree = CartScreen();
      for (const [at, effect] of effects) { cleanups.get(at)?.(); cleanups.set(at, effect()); }
      effects.clear(); return tree; },
    start() { const cleanup = focus(); return () => { cleanup(); for (const fn of cleanups.values()) fn?.(); }; },
    resume() { resume("active"); },
  };
}
function cartText(node) {
  if (Array.isArray(node)) return node.map(cartText).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? cartText(node.props?.children) : "";
}
const cartWithLine = (name, version) => ({ ...emptyCart, version, lines: [{ ...ownerLine, name }] });

test("clearing a Customer Store cart requires fresh confirmation and reconciles the same operation", async () => {
  const h = cartScreenHarness(); h.render(); const cleanup = h.start();
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  }
  const action = label => nodes(h.render()).find(node => node.type === "Pressable" && cartText(node) === label);
  const press = label => {
    const button = action(label);
    assert.ok(button, `missing cart action: ${label}`);
    button.props.onPress();
  };
  try {
    const cart = { ...cartWithLine("ماء", 5), actorId: "customer-clear" };
    h.reads[0].resolve({ kind: "ready", cart });
    await settle();
    press("تفريغ السلة");
    assert.equal(h.writes.length, 0);
    press("إلغاء");
    assert.equal(action("تأكيد التفريغ"), undefined);
    press("تفريغ السلة");
    const staleClear = action("تأكيد التفريغ");
    h.resume();
    h.reads[1].resolve({ kind: "ready", cart: { ...cart, version: 6 } });
    await settle();
    assert.equal(action("تأكيد التفريغ"), undefined);
    staleClear.props.onPress();
    assert.equal(h.writes.length, 0, "a superseded clear confirmation cannot dispatch a cart write");
    press("تفريغ السلة");
    press("تأكيد التفريغ");
    assert.equal(h.writes.length, 1);
    const first = h.writes[0];
    assert.equal(first.storeId, "store-a");
    assert.equal(first.actorId, "customer-clear");
    assert.deepEqual(first.original, { operationId: "cart-test-cart-command", expectedVersion: 6, lines: [] });
    first.reject(new DshCartError(0, "OPERATION_RESULT_UNKNOWN"));
    await settle();
    assert.match(cartText(h.render()), /ماء/);
    assert.equal(action("تفريغ السلة"), undefined);
    press("التحقق من نتيجة آخر تعديل");
    assert.equal(h.writes[1].original, first.original);
    h.writes[1].resolve({ cart: { ...cart, version: 7, lines: [] }, replay: true });
    await settle();
    assert.match(cartText(h.render()), /سلتك فارغة/);
  } finally { cleanup(); }
});

test("overlapping foreground cart reads cannot restore an older cart after a newer owner response", async () => {
  const h = cartScreenHarness(); h.render(); const cleanup = h.start();
  try {
    h.resume();
    assert.equal(h.reads.length, 2);
    h.reads[1].resolve({ kind: "ready", cart: cartWithLine("السلة الجديدة", 6) });
    await settle();
    assert.match(cartText(h.render()), /السلة الجديدة/);
    h.reads[0].resolve({ kind: "ready", cart: cartWithLine("السلة القديمة", 5) });
    await settle();
    const text = cartText(h.render());
    assert.doesNotMatch(text, /السلة القديمة/);
    assert.match(text, /السلة الجديدة/);
    assert.equal(h.reads[0].signal.aborted, true);
  } finally { cleanup(); }
});

test("owner estimate session denial conceals the previously verified private cart", async () => {
  const h = cartScreenHarness(); h.render(); const cleanup = h.start();
  try {
    h.reads[0].resolve({ kind: "ready", cart: cartWithLine("محتوى خاص بالسلة", 5) });
    await settle(); assert.match(cartText(h.render()), /محتوى خاص بالسلة/);
    assert.equal(h.estimates.length, 1);
    h.estimates[0].resolve({ kind: "signed-out" });
    await settle();
    const text = cartText(h.render());
    assert.doesNotMatch(text, /محتوى خاص بالسلة/);
    assert.match(text, /يجب تسجيل الدخول/);
  } finally { cleanup(); }
});

test("a denied estimate from a replaced read cannot conceal the newly verified cart", async () => {
  const h = cartScreenHarness(); h.render(); const cleanup = h.start();
  try {
    h.reads[0].resolve({ kind: "ready", cart: cartWithLine("السلة السابقة", 5) });
    await settle(); h.render();
    const stale = h.estimates[0];
    h.resume();
    assert.equal(stale.signal.aborted, true);
    h.reads[1].resolve({ kind: "ready", cart: cartWithLine("السلة الحالية", 6) });
    await settle(); h.render();
    stale.resolve({ kind: "signed-out" });
    await settle();
    assert.match(cartText(h.render()), /السلة الحالية/);
  } finally { cleanup(); }
});

test("only a verified draft shows card actions, plus and minus replace add, and the bar uses the owner price", () => {
  const { default: StoreProducts, StoreCartBar } = load(compiled[1], { "expo-router": { Link: "Link" } });
  const { default: ProductDetail } = load(compiled[2]);
  const calls = [];
  const session = { cart: null, busy: false, pending: false, message: "", adjust: (...args) => calls.push(args) };
  const card = (storeStatus = store.orderabilityStatus) => StoreProducts({
    offers: [offer], store: { ...store, orderabilityStatus: storeStatus }, session,
  }).props.children[0].props;

  assert.equal(card().onAdjust, undefined);
  session.cart = emptyCart;
  assert.equal(card("PAUSED").onAdjust, undefined);
  assert.equal(card("CLOSED_BY_SCHEDULE").onAdjust, undefined);
  ProductDetail(card()).props.children[1].props.onPress();
  assert.deepEqual(calls, [[offer, 1]]);

  session.cart = { ...emptyCart, lines: [ownerLine] };
  const updated = ProductDetail(card());
  assert.equal(card().quantity, 1);
  assert.equal(card().offer.priceYer, "175");
  const stepper = updated.props.children[1].props.children;
  assert.equal(stepper.length, 3);
  stepper[0].props.onPress();
  stepper[2].props.onPress();
  assert.deepEqual(calls.slice(1), [[offer, -1], [offer, 1]]);

  const bar = StoreCartBar({ storeId: store.id, session });
  const subtotal = bar.props.children[2].props.children.props.children[1].props.children;
  assert.equal(subtotal, `${formatExactYer(175n)} ريال يمني`);
  assert.equal(StoreCartBar({ storeId: store.id, session: { ...session, cart: emptyCart } }), null);
});

test("Store cart revalidates on native resume and discards superseded owner reads", async () => {
  const hooks = [], reads = [], writes = [];
  let index = 0, focus, resume, effectCleanup;
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useRef(initial) {
      const at = index++;
      hooks[at] ??= { current: initial };
      return hooks[at];
    },
    useCallback(callback) { return callback; },
    useEffect(effect) { if (!effectCleanup) effectCleanup = effect(); },
  };
  const { useStoreCart } = load(compiled[0], {
    react,
    "expo-crypto": { randomUUID: () => "resume-cart-operation" },
    "expo-router": { useFocusEffect(callback) { focus = callback; } },
    "react-native": { Platform: { OS: "android" }, AppState: {
      addEventListener(_event, callback) { resume = callback; return { remove() {} }; },
    } },
    "./cart-transport": {
      readVerifiedCart: (_storeId, signal) => new Promise(resolve => reads.push({ signal, resolve })),
      replaceVerifiedCart: (...args) => { writes.push(args); return new Promise(() => {}); },
    },
  });
  function render() {
    index = 0;
    // biome-ignore lint/correctness/useHookAtTopLevel: This fixture runs the hook under an ordered mock React renderer.
    return useStoreCart(store.id);
  }
  render();
  const cleanup = focus();
  try {
    reads[0].resolve({ kind: "ready", cart: emptyCart });
    await settle();
    assert.equal(render().cart.actorId, "customer-a");
    assert.equal(typeof resume, "function", "foreground listener is missing");
    resume("background");
    assert.equal(reads.length, 1);
    const stale = render();
    resume("active");
    assert.equal(render().cart, null);
    stale.adjust(offer, 1);
    assert.equal(writes.length, 0);
    resume("active");
    assert.equal(reads[1].signal.aborted, true);
    reads[1].resolve({ kind: "ready", cart: emptyCart });
    reads[2].resolve({ kind: "ready", cart: { ...emptyCart, actorId: "customer-b" } });
    await settle();
    assert.equal(render().cart.actorId, "customer-b");
    stale.adjust(offer, 1);
    assert.equal(writes.length, 0, "a superseded actor callback cannot dispatch after a fresh owner read");
    resume("active");
    reads[3].resolve({ kind: "signed-out" });
    await settle();
    assert.equal(render().cart, null);
    resume("active");
    cleanup();
    assert.equal(reads[4].signal.aborted, true);
    reads[4].resolve({ kind: "ready", cart: emptyCart });
    await settle();
    assert.equal(render().cart, null);
  } finally { cleanup(); effectCleanup?.(); }
});

test("bulk unavailable cleanup keeps eligible lines, requires confirmation and retries exact command", async () => {
  const h = cartScreenHarness(); h.render(); const cleanup = h.start();
  const nodes = node => !node || typeof node !== "object" ? [] :
    Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const action = label => nodes(h.render()).find(node => node.type === "Pressable" && cartText(node) === label);
  const press = label => { const b = action(label); assert.ok(b, "missing action: " + label); b.props.onPress(); };
  try {
    const cart = { ...emptyCart, actorId: "customer-bulk-clean", version: 5, lines: [
      { ...ownerLine, name: "Eligible", quantity: 3 },
      { ...ownerLine, offerId: "gone-a", name: "Unavailable A", previewAvailable: false },
      { ...ownerLine, offerId: "gone-b", name: "Unavailable B", previewAvailable: false },
    ] };
    h.reads[0].resolve({ kind: "ready", cart }); await settle();
    press("إزالة المنتجات غير المتاحة");
    assert.equal(h.writes.length, 0);
    const cancelled = action("تأكيد إزالة غير المتاح");
    press("إلغاء");
    cancelled.props.onPress();
    assert.equal(h.writes.length, 0);
    press("إزالة المنتجات غير المتاحة");
    const stale = action("تأكيد إزالة غير المتاح");
    h.resume(); h.reads[1].resolve({ kind: "ready", cart: { ...cart, version: 6 } }); await settle();
    stale.props.onPress();
    assert.equal(h.writes.length, 0);
    press("إزالة المنتجات غير المتاحة"); press("تأكيد إزالة غير المتاح");
    assert.equal(h.writes.length, 1);
    const first = h.writes[0];
    assert.deepEqual(first.original, { operationId: "cart-test-cart-command", expectedVersion: 6,
      lines: [{ offerId: ownerLine.offerId, quantity: 3 }] });
    assert.match(cartText(h.render()), /Unavailable A/);
    first.reject(new DshCartError(0, "OPERATION_RESULT_UNKNOWN")); await settle();
    assert.equal(action("إزالة المنتجات غير المتاحة"), undefined);
    press("التحقق من نتيجة آخر تعديل");
    assert.equal(h.writes[1].original, first.original);
    h.writes[1].resolve({ cart: { ...cart, version: 7, lines: [cart.lines[0]] }, replay: true }); await settle();
    assert.match(cartText(h.render()), /Eligible/);
    assert.doesNotMatch(cartText(h.render()), /Unavailable [AB]/);
    assert.equal(action("إزالة المنتجات غير المتاحة"), undefined);
  } finally { cleanup(); }
});