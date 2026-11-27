import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshPublicError, validCustomerCheckoutReviewInput } from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { formatExactYer } from "../../components/format-exact-yer.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const source = fileURLToPath(new URL("./checkout-review-form.tsx", import.meta.url));
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-checkout-fee-"));
let compiled;
try {
  const r = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"),
    source, "--ignoreConfig", "--noResolve",
    "--noCheck", "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx",
    "--inlineSourceMap", "--inlineSources", "--outDir", temp],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  compiled = readFileSync(path.join(temp, "checkout-review-form.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function flatten(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(flatten).join(" ");
  return flatten(tree.props?.children);
}
function harness({ platform = "android", initialState = "active", initiallyVisible = true } = {}) {
  const hooks = [], reads = [], verifications = [];
  const windowEvents = new Map(), documentEvents = new Map();
  let index = 0, listener, cleanup, poll;
  let appState = initialState, visible = initiallyVisible, focused = initiallyVisible;
  const eventTarget = events => ({
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name) { events.delete(name); },
  });
  const browserWindow = eventTarget(windowEvents);
  const browserDocument = { ...eventTarget(documentEvents), get visibilityState() { return visible ? "visible" : "hidden"; },
    hasFocus() { return focused; } };
  let verify = async () => ({ sessionExpiresAt: "2030-01-01T00:00:00Z" });
  const drafts = [];
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = typeof initial === "function" ? initial() : initial;
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
      if (!(at in hooks)) { hooks[at] = true; cleanup = callback(); }
    },
  };
  const mocks = {
    "@bthwani/dsh": { DshPublicError, validCustomerCheckoutReviewInput },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { AppState: { get currentState() { return appState; }, addEventListener(_event, fn) { listener = fn; return { remove() {} }; } },
      Platform: { OS: platform }, Pressable: "Pressable", Text: "Text", View: "View" },
    "../../components/format-exact-yer": { formatExactYer },
    "../addresses/address-transport": { verifyAddressSession: (...args) => { verifications.push(args); return verify(...args); } },
    "./delivery-address-review": { __esModule: true, default: "DeliveryAddressReview" },
    "./fulfillment-choice": { __esModule: true, default: "FulfillmentChoice" },
    "./recipient-form": { __esModule: true, default: "RecipientForm" },
    "./checkout-review-transport": {
      readCheckoutReview(actor, store, input, signal) {
        const call = { actor, store, input, signal }; reads.push(call);
        return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      },
    },
  };
  const module = loadMappedRenderFixture(compiled, source, mocks);
  loadedModules.push(module);
  // The harness is synchronous to install and each test restores its own globals.
  const original = new Map();
  for (const [key, value] of [["window", browserWindow], ["document", browserDocument]]) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const interval = mock.method(globalThis, "setInterval", callback => { poll = callback; return 1; });
  const clearInterval = mock.method(globalThis, "clearInterval", () => undefined);
  const remember = (scope, draft) => drafts.push({ scope, draft });
  return {
    reads, drafts, verifications, render() { index = 0; return module.exports.default({ actorId: "customer-a", storeId: "store-a", cartVersion: 4, onDraftChange: remember }); },
    poll() { poll(); },
    setVerify(fn) { verify = fn; },
    background() { appState = "background"; listener(appState); },
    foreground() { appState = "active"; listener(appState); },
    browserFocus() { focused = true; windowEvents.get("focus")?.(); },
    browserVisible() { visible = true; documentEvents.get("visibilitychange")?.(); },
    browserBlur() { focused = false; windowEvents.get("blur")?.(); },
    cleanup() {
      try { cleanup?.(); } finally {
        interval.mock.restore();
        clearInterval.mock.restore();
        for (const [key, descriptor] of original) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("checkout renders only owner distance fee evidence and clears it on method change or session background", async () => {
  const h = harness();
  const address = { id: "addr-00000000000000000000000000000001", version: 2 };
  const read = { kind: "ready", review: { actorId: "customer-a", storeId: "store-a", cartVersion: 4, salesChannel: "DIRECT",
    fulfillmentMode: "BTHWANI_CAPTAIN", merchandise: { merchandiseSubtotalYer: "1100" },
    delivery: { status: "SERVICEABLE" }, storeSchedule: { status: "OPEN_BY_SCHEDULE" },
    distanceFeeEstimate: { policyVersion: 7, distanceMetres: 2001, feeYer: "601" }, checkoutReady: false } };
  const find = type => nodes(h.render()).find(n => n.type === type && (type !== "Pressable" || n.props?.testID === "checkout-submit-review"));
  const fee = () => nodes(h.render()).find(n => n.props?.testID === "checkout-distance-fee-estimate");
  try {
    h.render(); await settle();
    nodes(h.render()).find(n => n.props?.testID === "checkout-sales-channel-DIRECT").props.onPress();
    find("FulfillmentChoice").props.onChange("BTHWANI_CAPTAIN");
    find("DeliveryAddressReview").props.onSelectionChange(address);
    find("Pressable").props.onPress();
    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.reads[0].input, { expectedCartVersion: 4, salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "BTHWANI_CAPTAIN", addressId: address.id, expectedAddressVersion: 2 });
    assert.equal(fee(), undefined);
    h.reads[0].resolve(read); await settle();
    assert.ok(flatten(fee()).includes(formatExactYer(601n)));
    assert.ok(flatten(fee()).includes("غير قابل للدفع"));
    find("FulfillmentChoice").props.onChange("CUSTOMER_PICKUP");
    assert.equal(fee(), undefined);
    find("FulfillmentChoice").props.onChange("BTHWANI_CAPTAIN");
    find("DeliveryAddressReview").props.onSelectionChange(address);
    find("Pressable").props.onPress();
    assert.equal(h.reads.length, 2);
    h.background();
    assert.equal(h.reads[1].signal.aborted, true);
    h.reads[1].resolve(read); await settle();
    assert.equal(fee(), undefined);
  } finally { h.cleanup(); }
});

test("transient verification failure hides checkout draft and restores it only after fresh same-actor verification", async () => {
  const h = harness();
  const find = type => nodes(h.render()).find(n => n.type === type && (type !== "Pressable" || n.props?.testID === "checkout-submit-review"));
  const recipient = { purpose: "OTHER", name: "Synthetic Recipient", phone: "+967770000099", instructions: "" };
  try {
    h.render(); await settle();
    nodes(h.render()).find(n => n.props?.testID === "checkout-sales-channel-DIRECT").props.onPress();
    find("FulfillmentChoice").props.onChange("CUSTOMER_PICKUP");
    find("RecipientForm").props.onChange(recipient);
    h.setVerify(async () => { throw new DshPublicError(503, "OWNER_UNAVAILABLE"); });
    h.poll(); await settle();
    assert.equal(find("RecipientForm"), undefined);
    h.setVerify(async () => ({ sessionExpiresAt: "2030-01-01T00:00:00Z" }));
    h.poll(); await settle();
    assert.deepEqual(find("RecipientForm").props.value, recipient);
    assert.equal(find("FulfillmentChoice").props.value, "CUSTOMER_PICKUP");
    h.setVerify(async () => { throw new DshPublicError(401, "UNAUTHORIZED"); });
    h.poll(); await settle();
    assert.equal(find("RecipientForm"), undefined);
    assert.equal(h.drafts.at(-1)?.draft, null);
  } finally { h.cleanup(); }
});

test("checkout never verifies or reveals a draft before native foreground admission", async () => {
  for (const initialState of ["background", "inactive", null]) {
    const h = harness({ initialState });
    const find = type => nodes(h.render()).find(n => n.type === type && (type !== "Pressable" || n.props?.testID === "checkout-submit-review"));
    try {
      h.render(); await settle(); h.poll(); await settle();
      assert.equal(h.verifications.length, 0, "hidden or unknown native state must not verify");
      assert.equal(find("RecipientForm"), undefined);
      h.foreground(); await settle();
      assert.equal(h.verifications.length, 1);
      assert.ok(find("RecipientForm"));
      h.background(); await settle(); h.poll(); await settle();
      assert.equal(h.verifications.length, 1);
      assert.equal(find("RecipientForm"), undefined);
    } finally { h.cleanup(); }
  }
});

test("hidden browser checkout stays concealed even after a focus event until visible", async () => {
  const h = harness({ platform: "web", initiallyVisible: false });
  const find = type => nodes(h.render()).find(n => n.type === type && (type !== "Pressable" || n.props?.testID === "checkout-submit-review"));
  try {
    h.render(); await settle();
    h.browserFocus(); await settle(); h.poll(); await settle();
    assert.equal(h.verifications.length, 0, "focus cannot admit a hidden tab");
    assert.equal(find("RecipientForm"), undefined);
    h.browserVisible(); await settle();
    assert.equal(h.verifications.length, 1);
    assert.ok(find("RecipientForm"));
    h.browserBlur(); await settle(); h.poll(); await settle();
    assert.equal(h.verifications.length, 1);
    assert.equal(find("RecipientForm"), undefined);
  } finally { h.cleanup(); }
});

test("invalid inputs and overlapping requests never start another owner review; failures permit retry", async () => {
  const h = harness();
  const find = type => nodes(h.render()).find(n => n.type === type && (type !== "Pressable" || n.props?.testID === "checkout-submit-review"));
  const alert = () => nodes(h.render()).find(n => n.props?.accessibilityRole === "alert");
  try {
    h.render(); await settle();
    assert.equal(find("Pressable").props.disabled, true);
    find("Pressable").props.onPress();
    assert.equal(h.reads.length, 0);
    nodes(h.render()).find(n => n.props?.testID === "checkout-sales-channel-DIRECT").props.onPress();
    find("FulfillmentChoice").props.onChange("BTHWANI_CAPTAIN");
    assert.equal(find("Pressable").props.disabled, true);
    find("DeliveryAddressReview").props.onSelectionChange({ id: "addr-00000000000000000000000000000001", version: 2 });
    find("RecipientForm").props.onChange({ purpose: "OTHER", name: "Recipient", phone: "invalid", instructions: "" });
    assert.equal(find("Pressable").props.disabled, true);
    find("RecipientForm").props.onChange({ purpose: "OTHER", name: " Recipient ", phone: "+967770000099", instructions: " Leave at door " });
    const press = find("Pressable").props.onPress;
    press(); press();
    assert.equal(h.reads.length, 1);
    assert.equal(find("Pressable").props.disabled, true);
    assert.equal(h.reads[0].input.recipientName, "Recipient");
    assert.equal(h.reads[0].input.deliveryInstructions, "Leave at door");
    h.reads[0].reject(new Error("synthetic transport failure")); await settle();
    assert.ok(alert());
    assert.equal(find("Pressable").props.disabled, false);
    find("Pressable").props.onPress();
    h.reads[1].resolve({ kind: "unavailable" }); await settle();
    assert.ok(alert());
    find("Pressable").props.onPress();
    h.reads[2].resolve({ kind: "signed-out" }); await settle();
    assert.equal(find("RecipientForm"), undefined);
    assert.equal(h.drafts.at(-1)?.draft, null);
  } finally { h.cleanup(); }
});

test("unavailable distance fee and schedule remain read-only; stale review cannot reappear after input change", async () => {
  const h = harness();
  const find = type => nodes(h.render()).find(n => n.type === type && (type !== "Pressable" || n.props?.testID === "checkout-submit-review"));
  const result = () => nodes(h.render()).find(n => n.props?.testID === "checkout-owner-input-review");
  try {
    h.render(); await settle();
    nodes(h.render()).find(n => n.props?.testID === "checkout-sales-channel-DIRECT").props.onPress();
    find("FulfillmentChoice").props.onChange("PARTNER_CAPTAIN");
    find("DeliveryAddressReview").props.onSelectionChange({ id: "addr-00000000000000000000000000000001", version: 2 });
    const pausedUntil = "2026-11-27T20:00:00.123456Z";
    const localExpiry = new Date("2026-11-27T20:00:00.000Z").toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "medium" });
    for (const [storeSchedule, policyStatus, message, hoursMessage] of [
      [{ status: "PAUSED", version: 4, pausedUntil }, "DENIED_BY_CITY_POLICY", "سياسة المدينة تمنع الطريقة المختارة لهذا المتجر.", `الإيقاف المؤقت حتى ${localExpiry} بتوقيت جهازك.`],
      [{ status: "PAUSED", version: 4 }, "DENIED_BY_CITY_POLICY", "سياسة المدينة تمنع الطريقة المختارة لهذا المتجر.", "المتجر متوقف مؤقتًا."],
      [{ status: "CLOSED_BY_SCHEDULE", version: 4 }, "ALLOWED_BY_CITY_POLICY", "سياسة المدينة تسمح بالطريقة المختارة.", "المتجر خارج ساعات العمل."],
      [{ status: "UNAVAILABLE" }, "UNCONFIGURED", "لم تُضبط سياسة المدينة لطرق التنفيذ لهذا المتجر.", "لم تتوفر أدلة كافية على ساعات عمل المتجر."],
    ]) {
      find("Pressable").props.onPress();
      h.reads.at(-1).resolve({ kind: "ready", review: {
        actorId: "customer-a", storeId: "store-a", cartVersion: 4, salesChannel: "DIRECT",
        fulfillmentMode: "PARTNER_CAPTAIN", merchandise: { merchandiseSubtotalYer: "1100" },
        delivery: { status: "UNSERVICEABLE" }, storeSchedule, checkoutReady: false,
        cityFulfillmentPolicy: { status: policyStatus, storeRelation: "DIRECT" },
      } });
      await settle();
      assert.ok(result());
      assert.ok(nodes(result()).some(n => n.props?.testID === "checkout-distance-fee-unavailable"));
      assert.ok(flatten(result()).includes(message));
      assert.ok(flatten(result()).includes(hoursMessage));
      assert.ok(flatten(result()).includes("لا يمكن تأكيد الطلب"));
    }
    find("Pressable").props.onPress();
    const previous = h.reads.at(-1);
    find("FulfillmentChoice").props.onChange("CUSTOMER_PICKUP");
    assert.equal(previous.signal.aborted, true);
    previous.resolve({ kind: "ready", review: {} }); await settle();
    assert.equal(result(), undefined);
  } finally { h.cleanup(); }
});

test("sales-channel choices expose keyboard-compatible selected buttons and preserve exact review/draft scope", async () => {
  const h = harness({ platform: "web" });
  const find = id => nodes(h.render()).find(n => n.props?.testID === id);
  const direct = () => find("checkout-sales-channel-DIRECT");
  const market = () => find("checkout-sales-channel-MARKETPLACE");
  const submit = () => find("checkout-submit-review");
  try {
    h.render(); await settle();
    for (const control of [direct(),market()]) {
      assert.equal(control.props.accessibilityRole,"button");
      assert.equal(control.props.accessibilityState.selected,false);
      assert.ok(control.props.accessibilityLabel);
    }
    direct().props.onPress();
    assert.equal(direct().props.accessibilityState.selected,true);
    assert.equal(market().props.accessibilityState.selected,false);
    nodes(h.render()).find(n => n.type === "FulfillmentChoice").props.onChange("CUSTOMER_PICKUP");
    submit().props.onPress();
    assert.equal(h.reads[0].input.salesChannel,"DIRECT");
    assert.equal(direct().props.disabled,true);
    market().props.onPress();
    assert.equal(h.drafts.at(-1).draft.salesChannel,"DIRECT","busy selection must not change");
    h.reads[0].resolve({ kind:"ready",review:{ actorId:"customer-a",storeId:"store-a",cartVersion:4,salesChannel:"DIRECT",
      fulfillmentMode:"CUSTOMER_PICKUP",merchandise:{merchandiseSubtotalYer:"1100"},storeSchedule:{status:"OPEN_BY_SCHEDULE"},checkoutReady:false } });
    await settle();
    assert.ok(find("checkout-owner-input-review"));
    market().props.onPress();
    assert.equal(market().props.accessibilityState.selected,true);
    assert.equal(direct().props.accessibilityState.selected,false);
    assert.equal(find("checkout-owner-input-review"),undefined);
    assert.deepEqual(h.drafts.at(-1),{scope:JSON.stringify(["customer-a","store-a",4]),
      draft:{recipient:{purpose:"SELF",name:"",phone:"",instructions:""},mode:"CUSTOMER_PICKUP",salesChannel:"MARKETPLACE"}});
    submit().props.onPress();
    assert.equal(h.reads[1].input.salesChannel,"MARKETPLACE");
    const staleSubmit=submit().props.onPress;
    h.browserBlur();
    assert.equal(h.reads[1].signal.aborted,true);
    staleSubmit();
    assert.equal(h.reads.length,2,"hidden stale press cannot issue owner request");
    assert.equal(find("checkout-owner-input-review"),undefined);
  } finally { h.cleanup(); }
});
