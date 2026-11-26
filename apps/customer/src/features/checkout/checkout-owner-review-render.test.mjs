import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { formatExactYer } from "../../components/format-exact-yer.ts";
import { previewLineSubtotalYer, summarizeCartPreview } from "../cart/cart-preview.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sourceFile = fileURLToPath(new URL("./checkout-screen.tsx", import.meta.url));
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-checkout-review-"));

let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), sourceFile,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp,
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

function harness(startStore = "store-one", deferFunding = false) {
  let storeId = startStore;
  let focus;
  let cleanup;
  const hooks = [];
  let index = 0;
  const calls = [];
  const estimates = [];
  const fundingReads = [];
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
    useEffect(callback) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = { cleanup: callback() };
    },
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
      AppState: { addEventListener() { return { remove() {} }; } },
      Platform: { OS: "android" },
      Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../../components/format-exact-yer": { formatExactYer },
    "../cart/cart-preview": { previewLineSubtotalYer, summarizeCartPreview },
    "./delivery-address-review": { __esModule: true, default: "DeliveryAddressReview" },
    "./fulfillment-choice": { __esModule: true, default: "FulfillmentChoice" },
    "./payment-selection": { __esModule: true, default: "PaymentSelection" },
    "./recipient-form": { __esModule: true, default: "RecipientForm" },
    "../cart/cart-transport": {
      readVerifiedCart(store, signal) {
        const call = { store, signal };
        calls.push(call);
        return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      },
      readVerifiedCartMerchandiseEstimate(store, version, actor, signal) {
        const call = { store, version, actor, signal };
        estimates.push(call);
        return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      },
    },
    "./checkout-review-form": { __esModule: true, default: "CheckoutReviewForm" },
    "./checkout-funding": {
      // This isolated UI harness deliberately supplies no WLT balance. The
      // real WLT adapter is tested independently; unavailable must not hide
      // an otherwise current DSH Cart or suggest payment authorization.
      readCheckoutFunding(actor, signal) {
        if (!deferFunding) return Promise.resolve({ kind: "unavailable" });
        const call = { actor, signal };
        fundingReads.push(call);
        return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      },
    },
  };
  const module = loadMappedRenderFixture(compiled, sourceFile, mocks);
  loadedModules.push(module);
  function render() {
    index = 0;
    return module.exports.default();
  }
  return {
    render, get calls() { return calls; }, get estimates() { return estimates; }, get fundingReads() { return fundingReads; },
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
  for (const component of ["RecipientForm", "FulfillmentChoice", "PaymentSelection"]) {
    const item = nodes(view).find(n => n.type === component);
    assert.ok(item, `${component} remains in the read-only review`);
    assert.ok(item.props.label?.includes("لم"), `${component} cannot claim an approved decision`);
  }
  const links = nodes(view).filter(n => n.type === "Link").map(n => n.props.href);
  assert.deepEqual(links, [{ pathname: "/cart/[storeId]", params: { storeId: "store-one" } }]);
  assert.ok(!nodes(view).some(n => n.type === "Pressable" &&
    /تأكيد|دفع|شراء/.test(flatten(n))));
  assert.ok(!nodes(view).some(n => n.type === "Pressable" &&
    flatten(n).includes("تحديث المراجعة")), "checkout must not require a permanent refresh button");
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


function merchandise(storeId = "store-one", actorId = "customer-one", version = 8,
  amount = "18014398509481986") {
  return { actorId, storeId, cartVersion: version,
    lines: [{ offerId: "offer-water", variantId: "variant-water", quantity: 2,
      unitYer: "9007199254740993", lineTotalYer: "18014398509481986" }],
    merchandiseSubtotalYer: amount, checkoutReady: false };
}

test("Checkout requests the exact current DSH cart version and shows no owner amount until verified", async () => {
  const h = harness("store-one");
  h.render(); h.focus();
  h.calls[0].resolve({ kind: "ready", cart: fixture("store-one") });
  await settle();
  assert.equal(h.estimates.length, 1);
  assert.deepEqual([h.estimates[0].store, h.estimates[0].version, h.estimates[0].actor],
    ["store-one", 8, "customer-one"]);
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-owner-merchandise-subtotal"));
  h.estimates[0].resolve({ kind: "ready", estimate: merchandise() });
  await settle();
  const view = h.render();
  const amount = new Intl.NumberFormat("ar-YE").format(18014398509481986n);
  const subtotal = nodes(view).find(n => n.props?.testID === "checkout-owner-merchandise-subtotal");
  assert.ok(subtotal, "DSH owner-derived amount appears independently of the local Cart preview");
  assert.ok(flatten(subtotal).includes(amount));
  assert.ok(nodes(view).some(n => n.props?.testID === "checkout-confirmation-unavailable"));
  h.blur();
});

test("Cross-actor or stale-version DSH estimates cannot be displayed as verified", async () => {
  const h = harness("store-one");
  h.render(); h.focus();
  h.calls[0].resolve({ kind: "ready", cart: fixture("store-one") });
  await settle();
  h.estimates[0].resolve({ kind: "ready", estimate: merchandise("store-one", "another-customer") });
  await settle();
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-owner-merchandise-subtotal"));
  h.blur();

  h.render(); h.focus();
  h.calls[1].resolve({ kind: "ready", cart: fixture("store-one") });
  await settle();
  h.estimates[1].resolve({ kind: "ready", estimate: merchandise("store-one", "customer-one", 7) });
  await settle();
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-owner-merchandise-subtotal"));
  h.blur();
});

test("Changing Store aborts in-flight estimates and late results never appear for another Store", async () => {
  const h = harness("store-a");
  h.render(); h.focus();
  h.calls[0].resolve({ kind: "ready", cart: fixture("store-a") });
  await settle();
  const prior = h.estimates[0];
  h.blur();
  h.store("store-b"); h.render(); h.focus();
  assert.equal(prior.signal.aborted, true);
  prior.resolve({ kind: "ready", estimate: merchandise("store-a") });
  await settle();
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-owner-merchandise-subtotal"));
  h.calls[1].resolve({ kind: "ready", cart: fixture("store-b") });
  await settle();
  h.estimates[1].resolve({ kind: "ready", estimate: merchandise("store-b") });
  await settle();
  assert.ok(nodes(h.render()).some(n => n.props?.testID === "checkout-owner-merchandise-subtotal"));
  h.blur();
});

test("Owner estimate rejection remains unavailable, and Identity sign-out clears checkout review", async () => {
  const h = harness("store-one");
  h.render(); h.focus();
  h.calls[0].resolve({ kind: "ready", cart: fixture("store-one") });
  await settle();
  h.estimates[0].reject(new Error("DSH stock or version changed"));
  await settle();
  assert.ok(flatten(h.render()).includes("تعذّر التحقق من تقدير البضائع"));
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-owner-merchandise-subtotal"));
  h.blur();

  h.render(); h.focus();
  h.calls[1].resolve({ kind: "ready", cart: fixture("store-one") });
  await settle();
  h.estimates[1].resolve({ kind: "signed-out" });
  await settle();
  assert.ok(flatten(h.render()).includes("سجل الدخول"));
  assert.ok(!nodes(h.render()).some(n => n.props?.testID === "checkout-cart-review"));
  h.blur();
});

test("eligible cart mounts the interactive owner review with the exact cart scope, never an order confirmation", async () => {
  const h = harness("store-a");
  h.render(); h.focus();
  const cart = fixture("store-a");
  cart.lines = cart.lines.filter(line => line.previewAvailable);
  h.calls[0].resolve({ kind: "ready", cart });
  await settle();
  const tree = h.render();
  const form = nodes(tree).find(n => n.type === "CheckoutReviewForm");
  assert.ok(form);
  assert.equal(form.props.actorId, cart.actorId);
  assert.equal(form.props.storeId, cart.storeId);
  assert.equal(form.props.cartVersion, cart.version);
  assert.ok(nodes(tree).some(n => n.props?.testID === "checkout-confirmation-unavailable"));
  h.blur();
  assert.ok(!nodes(h.render()).some(n => n.type === "CheckoutReviewForm"));
});

test("checkout retains only same actor/store/cart draft through transient owner outage and clears on denial or scope change", async () => {
  const h = harness("store-a");
  const cart = fixture("store-a");
  cart.lines = cart.lines.filter(line => line.previewAvailable);
  const form = () => nodes(h.render()).find(n => n.type === "CheckoutReviewForm");
  const draft = { recipient: { purpose: "OTHER", name: "Synthetic Recipient", phone: "+967770000099", instructions: "" }, mode: "CUSTOMER_PICKUP", salesChannel: "DIRECT" };
  const reload = async result => {
    h.blur(); h.render(); h.focus();
    h.calls.at(-1).resolve(result);
    await settle();
  };
  h.render(); h.focus(); h.calls[0].resolve({ kind: "ready", cart }); await settle();
  const scope = JSON.stringify([cart.actorId, cart.storeId, cart.version]);
  form().props.onDraftChange(scope, draft);
  await reload({ kind: "unavailable" });
  assert.equal(form(), undefined);
  await reload({ kind: "ready", cart });
  assert.deepEqual(form().props.initialDraft, draft);
  await reload({ kind: "signed-out" });
  assert.equal(form(), undefined);
  await reload({ kind: "ready", cart });
  assert.equal(form().props.initialDraft, undefined);
  form().props.onDraftChange(scope, draft);
  await reload({ kind: "ready", cart: { ...cart, actorId: "customer-two" } });
  assert.equal(form().props.initialDraft, undefined);
  form().props.onDraftChange(scope, draft);
  await reload({ kind: "ready", cart });
  assert.equal(form().props.initialDraft, undefined, "late previous scope callback must not restore old draft");
  form().props.onDraftChange(scope, draft);
  await reload({ kind: "ready", cart: { ...cart, version: 9 } });
  assert.equal(form().props.initialDraft, undefined);
  h.blur();
});

test("verified WLT preview stays read-only, rejection allows retry, and denial conceals the cart", async () => {
  const h = harness("store-one", true);
  const cart = fixture("store-one");
  const review = () => nodes(h.render()).find(n => n.props?.testID === "checkout-wlt-balance-review");
  const reload = async () => {
    h.blur(); h.render(); h.focus();
    h.calls.at(-1).resolve({ kind: "ready", cart }); await settle();
  };
  try {
    h.render(); h.focus(); h.calls[0].resolve({ kind: "ready", cart }); await settle();
    const first = h.fundingReads[0];
    assert.equal(first.actor, cart.actorId);
    first.resolve({ kind: "ready", balance: { actorId: cart.actorId, currency: "YER",
      balanceYer: "9007199254740993", availableYer: "9007199254740992" }, expiresAt: Date.now() + 60_000 });
    await settle();
    assert.ok(flatten(review()).includes(formatExactYer(9007199254740992n)));
    assert.ok(nodes(h.render()).some(n => n.props?.testID === "checkout-confirmation-unavailable"));
    await reload();
    assert.equal(first.signal.aborted, true);
    h.fundingReads.at(-1).reject(new Error("synthetic WLT outage")); await settle();
    assert.ok(flatten(review()).includes("تعذّر التحقق من رصيد المحفظة"));
    assert.ok(nodes(h.render()).some(n => n.type === "Pressable" && flatten(n).includes("إعادة المحاولة")));
    await reload();
    const stale = h.fundingReads.at(-1);
    await reload();
    assert.equal(stale.signal.aborted, true);
    stale.resolve({ kind: "ready", balance: { availableYer: "999" }, expiresAt: Date.now() + 60_000 });
    await settle();
    assert.ok(!flatten(review()).includes(formatExactYer(999n)));
    h.fundingReads.at(-1).resolve({ kind: "signed-out" }); await settle();
    assert.equal(review(), undefined);
    assert.ok(flatten(h.render()).includes("سجل الدخول"));
  } finally { h.blur(); }
});

test("empty cart has no private review inputs and no order confirmation", async () => {
  const h = harness("store-one");
  try {
    h.render(); h.focus();
    h.calls[0].resolve({ kind: "ready", cart: { ...fixture("store-one"), lines: [] } });
    await settle();
    const tree = h.render();
    assert.ok(flatten(tree).includes("السلة فارغة"));
    assert.ok(!nodes(tree).some(n => n.type === "CheckoutReviewForm" || n.props?.testID === "checkout-cart-review"));
    assert.ok(nodes(tree).some(n => n.props?.testID === "checkout-confirmation-unavailable"));
  } finally { h.blur(); }
});

test("expired WLT evidence immediately conceals the previous cart and wallet preview", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const h = harness("store-one", true);
  try {
    h.render(); h.focus();
    const cart = fixture("store-one");
    h.calls[0].resolve({ kind: "ready", cart }); await settle();
    h.fundingReads[0].resolve({ kind: "ready", balance: { actorId: cart.actorId,
      availableYer: "9007199254740992" }, expiresAt: 2_000 });
    await settle();
    assert.ok(nodes(h.render()).some(n => n.props?.testID === "checkout-wlt-balance-review"));
    t.mock.timers.tick(1_000);
    const view = h.render();
    assert.ok(!nodes(view).some(n => n.props?.testID === "checkout-wlt-balance-review" ||
      n.props?.testID === "checkout-cart-review" || n.type === "CheckoutReviewForm"));
    assert.ok(nodes(view).some(n => n.props?.testID === "checkout-confirmation-unavailable"));
  } finally { h.blur(); t.mock.timers.reset(); }
});
