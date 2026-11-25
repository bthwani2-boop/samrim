import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshPublicError, validCustomerCheckoutReviewInput } from "@bthwani/dsh";
import { formatExactYer } from "../../components/format-exact-yer.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-checkout-fee-"));
let compiled;
try {
  const r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    fileURLToPath(new URL("./checkout-review-form.tsx", import.meta.url)), "--ignoreConfig", "--noResolve",
    "--noCheck", "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp],
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
        return new Promise(resolve => { call.resolve = resolve; });
      },
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "setInterval", "clearInterval", "window", "document", compiled)(name => {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency " + name);
    return mocks[name];
  }, module, module.exports, callback => { poll = callback; return 1; }, () => undefined, browserWindow, browserDocument);
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
    cleanup() { cleanup?.(); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("checkout renders only owner distance fee evidence and clears it on method change or session background", async () => {
  const h = harness();
  const address = { id: "addr-00000000000000000000000000000001", version: 2 };
  const read = { kind: "ready", review: { actorId: "customer-a", storeId: "store-a", cartVersion: 4,
    fulfillmentMode: "BTHWANI_CAPTAIN", merchandise: { merchandiseSubtotalYer: "1100" },
    delivery: { status: "SERVICEABLE" }, storeSchedule: { status: "OPEN_BY_SCHEDULE" },
    distanceFeeEstimate: { policyVersion: 7, distanceMetres: 2001, feeYer: "601" }, checkoutReady: false } };
  const find = type => nodes(h.render()).find(n => n.type === type);
  const fee = () => nodes(h.render()).find(n => n.props?.testID === "checkout-distance-fee-estimate");
  try {
    h.render(); await settle();
    find("FulfillmentChoice").props.onChange("BTHWANI_CAPTAIN");
    find("DeliveryAddressReview").props.onSelectionChange(address);
    find("Pressable").props.onPress();
    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.reads[0].input, { expectedCartVersion: 4, recipientPurpose: "SELF", fulfillmentMode: "BTHWANI_CAPTAIN", addressId: address.id, expectedAddressVersion: 2 });
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
  const find = type => nodes(h.render()).find(n => n.type === type);
  const recipient = { purpose: "OTHER", name: "Synthetic Recipient", phone: "+967770000099", instructions: "" };
  try {
    h.render(); await settle();
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
    const find = type => nodes(h.render()).find(n => n.type === type);
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
  const find = type => nodes(h.render()).find(n => n.type === type);
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
