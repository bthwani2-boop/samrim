import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real asynchronous read callback, not a duplicated actor-scope decision.
const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/features/multi-store-checkout/multi-store-checkout.tsx"), "utf8");
const ast = ts.createSourceFile("multi-store-checkout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadNode;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load") loadNode = node;
  ts.forEachChild(node, walk);
}
walk(ast);
assert.ok(loadNode?.initializer, "the real multi-store load callback must exist");
const runnable = ts.transpileModule("const load = " + loadNode.initializer.getText(ast) + "; load;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function scenario({ switchDuringRead = false } = {}) {
  const states = [];
  let actorID = "client-A";
  const session = () => ({ kind: "authenticated", identity: { subject: actorID } });
  const ctx = {
    useCallback: (callback) => callback,
    loadRequestID: { current: 0 },
    selectedCityID: "city-1",
    setState: (value) => states.push(value),
    setQuotePreview: () => {},
    setError: () => {},
    setPendingAttempt: () => {},
    authenticatedClientActorID: async () => "client-A",
    pendingMultiStoreAttemptKey: (actor) => "pending:" + actor,
    SecureStore: { getItemAsync: async () => null, deleteItemAsync: async () => {} },
    parsePendingMultiStoreAttempt: () => null,
    hasCurrentMultiStoreActor: (actor) => session().kind === "authenticated" && session().identity.subject === actor,
    listOwnOpenCarts: async () => {
      if (switchDuringRead) actorID = "client-B";
      return { carts: [
        { storeId: "store-A", storeName: "Private store A", cartId: "cart-A", cartVersion: 1, lineCount: 1, serviceCityId: "city-1" },
        { storeId: "store-B", storeName: "Private store B", cartId: "cart-B", cartVersion: 1, lineCount: 1, serviceCityId: "city-1" },
      ] };
    },
    listOwnDeliveryAddresses: async () => ({ addresses: [{ id: "private-address-A", addressText: "private" }] }),
    getUsableIdentityAccessToken: async () => "token-A",
    readPublishedStore: async (storeID) => ({ id: storeID, publicationState: "published" }),
    readCartForPreview: async () => ({
      version: 1,
      lines: [{ requiresReview: false, lineAmountMinor: 1500 }],
    }),
    availableCustomerFulfillmentModes: (modes) => modes ?? ["CUSTOMER_PICKUP"],
    readSavedFulfillmentMode: async () => null,
    resolveFulfillmentChoice: (available) => available[0] ?? null,
    setMultiMode: () => {},
    resolvePendingMultiStoreAttempt: async () => { throw new Error("no pending attempt"); },
    console: { error: () => {} },
  };
  const load = vm.runInNewContext(runnable, ctx);
  return { load, states };
}

test("multi-store readback for current actor remains visible", async () => {
  const { load, states } = scenario();
  await load();
  assert.equal(states.at(-1).kind, "ready");
  assert.equal(states.at(-1).addresses[0].id, "private-address-A");
});

test("old actor's carts and addresses never become visible after session switch mid-read", async () => {
  const { load, states } = scenario({ switchDuringRead: true });
  await load();
  assert.ok(!states.some((state) => state.kind === "ready" || state.kind === "single"),
    "outdated response must not publish private carts/addresses after identity changes");
});

let submitNode;
function findSubmit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submitNode = node;
  ts.forEachChild(node, findSubmit);
}
findSubmit(ast);
assert.ok(submitNode, "the actual multi-store submit handler must exist");
const submitCode = ts.transpileModule(submitNode.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function quotedCheckoutScenario(switchDuringQuote) {
  let actorID = "client-A";
  const previews = [];
  const calls = { quote: 0, persist: 0, create: 0 };
  const stores = ["store-A", "store-B"].map((id) => ({
    store: { storeId: id, storeName: id, publicationState: "published", fulfillmentModes: ["CUSTOMER_PICKUP"] },
    cart: { id: "cart-" + id, version: 2, lineCount: 1 },
  }));
  const ctx = {
    submitInFlight: { current: false },
    busy: false,
    pendingAttempt: null,
    state: { kind: "ready", selectedStoreIDs: ["store-A", "store-B"], storeCarts: stores, fulfillmentModes: { "store-A": "CUSTOMER_PICKUP", "store-B": "CUSTOMER_PICKUP" }, selectedAddressID: "" },
    selectedFulfillmentMode: () => "CUSTOMER_PICKUP",
    deliveryRecipientIsValid: () => true,
    recipient: { mode: "SELF" },
    quotePreview: null,
    setBusy: () => {},
    setError: () => {},
    setQuotePreview: (value) => previews.push(value),
    setPendingAttempt: () => {},
    setState: () => {},
    authenticatedClientActorID: async () => "client-A",
    hasCurrentMultiStoreActor: (expected) => actorID === expected,
    quoteMultiStoreChildCheckout: async (request, version) => {
      calls.quote++;
      if (switchDuringQuote) actorID = "client-B";
      return { quote: { ...request, cartVersion: version, currency: "YER", totalAmountMinor: 2500 } };
    },
    Crypto: { randomUUID: () => "id" },
    SecureStore: { setItemAsync: async () => { calls.persist++; } },
    createMultiStoreCheckout: async () => { calls.create++; },
    checkoutRecipient: () => ({ mode: "SELF" }),
    console: { error: () => {} },
  };
  const submit = vm.runInNewContext(submitCode + "\nsubmit", ctx);
  return { submit, previews, calls };
}

test("multi-store quote preview remains available without identity change", async () => {
  const { submit, previews, calls } = quotedCheckoutScenario(false);
  await submit();
  assert.equal(previews.length, 1);
  assert.equal(previews[0].totalAmountMinor, 5000);
  assert.equal(calls.create, 0);
  assert.equal(calls.persist, 0);
});

test("quote returning after actor switch never publishes the prior customer's quote or submits a payment", async () => {
  const { submit, previews, calls } = quotedCheckoutScenario(true);
  await submit();
  assert.equal(calls.quote, 2);
  assert.equal(previews.length, 0, "previous actor quote may not surface");
  assert.equal(calls.persist, 0, "no durable attempt may be created for a switched actor");
  assert.equal(calls.create, 0, "must not create another customer's checkout");
});

test("multi-store checkout subscribes to identity change and invalidates stale state", () => {
  assert.match(source, /subscribeIdentitySession\(\(session\) =>/);
  assert.match(source, /loadRequestID\.current \+= 1;[\s\S]*?setPendingAttempt\(null\);[\s\S]*?setQuotePreview\(null\);/);
});
