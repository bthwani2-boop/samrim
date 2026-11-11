import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientOrderSessionKey } from "../orders/order-session-scope.ts";

const source = readFileSync(new URL("./multi-store-checkout.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("multi-store-checkout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
let sessionEffect = "";
let loadCallback = "";
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load" && node.initializer && ts.isCallExpression(node.initializer)) {
    loadCallback = node.initializer.arguments[0]?.getText(ast) ?? "";
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const effect = node.arguments[0]?.getText(ast) ?? "";
    if (effect.includes("subscribeIdentitySession")) sessionEffect = effect;
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function production(runtime, names) {
  const helpers = ["authenticatedClientActorID", "hasCurrentMultiStoreSession", "isDshHttpStatus", "isTerminalMultiStoreCheckout", "resolvePendingMultiStoreAttempt"];
  const selected = [...new Set([...helpers, ...names])];
  for (const name of selected) assert.ok(declarations.has(name), `missing production callback/helper ${name}`);
  const compiled = ts.transpileModule(`${selected.map(name => declarations.get(name)).join("\n")}\n({${names.join(", ")}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(compiled, { clientOrderSessionKey, ...runtime });
}

function actor(subject = "client-a", sessionId = "session-1", role = "client") {
  return { kind: "authenticated", identity: { subject, sessionId, role } };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let identity = actor();
  let sequence = 0;
  const sessionKey = clientOrderSessionKey(identity);
  const stores = ["store-1", "store-2"].map((storeId, index) => ({
    store: { storeId, storeName: `Store ${index + 1}`, publicationState: "published", fulfillmentModes: ["CUSTOMER_PICKUP"] },
    cart: { id: `cart-${index + 1}`, version: 1 },
  }));
  const state = {
    kind: "ready",
    selectedStoreIDs: stores.map(item => item.store.storeId),
    storeCarts: stores,
    selectedAddressID: "",
    fulfillmentModes: { "store-1": "CUSTOMER_PICKUP", "store-2": "CUSTOMER_PICKUP" },
  };
  const actions = { quote: [], created: [], pending: [], state: [], errors: [], busy: [], deleted: [], stored: [] };
  const runtime = {
    currentIdentityState: () => identity,
    clientOrderSessionKey,
    getUsableIdentityAccessToken: async () => "identity-token",
    activeSessionRef: { current: sessionKey },
    submitAttemptID: { current: 0 },
    submitInFlight: { current: false },
    state, busy: false, pendingAttempt: null, quotePreview: null,
    recipient: { mode: "SELF" },
    selectedFulfillmentMode: store => state.fulfillmentModes[store.storeId],
    deliveryRecipientIsValid: () => true,
    quoteMultiStoreChildCheckout: async ({ cartId, storeId, addressId, fulfillmentMode }, cartVersion) => ({
      quote: { cartId, storeId, addressId, fulfillmentMode, cartVersion, totalAmountMinor: 100, currency: "YER" },
    }),
    setBusy: value => actions.busy.push(value),
    setError: value => actions.errors.push(value),
    setQuotePreview: value => actions.quote.push(value),
    setPendingAttempt: value => actions.pending.push(value),
    setState: value => actions.state.push(value),
    acknowledgedDiscoveryClickForCheckout: async () => undefined,
    selectedCityID: "sanaa",
    Crypto: { randomUUID: () => String(++sequence) },
    SecureStore: {
      setItemAsync: async (key, value) => { actions.stored.push({ key, value }); },
      deleteItemAsync: async key => { actions.deleted.push(key); },
    },
    pendingMultiStoreAttemptKey: id => `pending.${id}`,
    serializePendingMultiStoreAttempt: value => JSON.stringify(value),
    checkoutRecipient: value => value,
    createMultiStoreCheckout: async (request, idempotencyKey) => {
      actions.created.push({ request, idempotencyKey });
      return { checkout: { state: "COMPLETE" } };
    },
  };
  return {
    runtime, actions, sessionKey,
    renew: () => { identity = actor("client-a", "session-2"); },
    switchActor: () => { identity = actor("client-b", "session-1"); },
    signOut: () => { identity = { kind: "signed_out" }; },
    quotePreview: () => {
      const fingerprint = JSON.stringify({
        sessionKey, actorID: "client-a",
        stores: stores.map(item => [item.store.storeId, item.cart.id, 1, "CUSTOMER_PICKUP", ""]),
        recipient: { mode: "SELF" },
      });
      const children = stores.map(item => ({
        storeName: item.store.storeName,
        quote: { cartId: item.cart.id, storeId: item.store.storeId, addressId: "", cartVersion: 1, fulfillmentMode: "CUSTOMER_PICKUP", totalAmountMinor: 100, currency: "YER" },
      }));
      return { fingerprint, children, totalAmountMinor: 200 };
    },
  };
}

test("multi-Store session identity rejects same-actor reauthentication and non-client sessions", () => {
  const x = fixture();
  const { hasCurrentMultiStoreSession } = production(x.runtime, ["hasCurrentMultiStoreSession"]);
  assert.equal(hasCurrentMultiStoreSession(x.sessionKey), true);
  x.renew();
  assert.equal(hasCurrentMultiStoreSession(x.sessionKey), false);
  x.signOut();
  assert.equal(hasCurrentMultiStoreSession(x.sessionKey), false);
  assert.equal(clientOrderSessionKey(actor("client-a", "session-1", "partner")), "");
});

test("a quote returned to the old same-actor session is never exposed for acceptance", async () => {
  const x = fixture();
  const deferredQuote = deferred();
  const started = deferred();
  x.runtime.quoteMultiStoreChildCheckout = (...args) => {
    started.resolve();
    return deferredQuote.promise.then(() => ({
      quote: { cartId: args[0].cartId, storeId: args[0].storeId, addressId: "", cartVersion: 1, fulfillmentMode: "CUSTOMER_PICKUP", totalAmountMinor: 100, currency: "YER" },
    }));
  };
  const checkout = production(x.runtime, ["submit"]).submit();
  await started.promise;
  x.renew();
  deferredQuote.resolve();
  await checkout;
  assert.equal(x.actions.quote.length, 0);
  assert.equal(x.actions.created.length, 0);
  assert.equal(x.actions.stored.length, 0);
});

test("previous session's accepted quote cannot initiate a new checkout before subscription catches up", async () => {
  const x = fixture();
  x.runtime.quotePreview = x.quotePreview();
  x.renew();
  await production(x.runtime, ["submit"]).submit();
  assert.equal(x.actions.created.length, 0);
  assert.equal(x.actions.stored.length, 0);
  assert.deepEqual(x.actions.busy, []);
});

test("late DSH completion cannot show another session's child Orders; persisted retry is not discarded", async () => {
  const x = fixture();
  x.runtime.quotePreview = x.quotePreview();
  const started = deferred();
  const finished = deferred();
  x.runtime.createMultiStoreCheckout = async (request, idempotencyKey) => {
    x.actions.created.push({ request, idempotencyKey });
    started.resolve();
    return finished.promise;
  };
  const checkout = production(x.runtime, ["submit"]).submit();
  await started.promise;
  assert.equal(x.actions.stored.length, 1);
  x.renew();
  finished.resolve({ checkout: { state: "COMPLETE" } });
  await checkout;
  assert.equal(x.actions.created.length, 1);
  assert.equal(x.actions.deleted.length, 0, "unknown prior session result keeps its actor-keyed recovery record");
  assert.equal(x.actions.state.length, 0);
});

test("stale reconciliation 404 cannot trigger a DSH create POST after the session changes", async () => {
  const x = fixture();
  const reading = deferred();
  const started = deferred();
  x.runtime.readOwnMultiStoreCheckout = async () => {
    started.resolve();
    return reading.promise;
  };
  const attempt = { kind: "CREATE", actorID: "client-a", idempotencyKey: "idem-abc12345", correlationID: "corr-abc12345", request: { id: "multi-1", children: [] } };
  const { resolvePendingMultiStoreAttempt } = production(x.runtime, ["resolvePendingMultiStoreAttempt"]);
  const check = resolvePendingMultiStoreAttempt(attempt, () => clientOrderSessionKey(x.runtime.currentIdentityState()) === x.sessionKey, x.sessionKey);
  await started.promise;
  x.renew();
  reading.reject({ kind: "http", status: 404 });
  const result = await check;
  assert.equal(result.terminal, false);
  assert.equal(x.actions.created.length, 0);
});

test("Identity session subscription resets previous recipients, quotes, busy state and in-flight sequence", () => {
  assert.ok(sessionEffect, "production subscription must be present");
  const x = fixture();
  let subscriber;
  let reloads = 0;
  const reset = { recipient: [], quote: [], pending: [], state: [], busy: [], modes: [], errors: [] };
  const context = {
    clientOrderSessionKey,
    currentIdentityState: x.runtime.currentIdentityState,
    load: () => { reloads++; },
    subscribeIdentitySession: callback => { subscriber = callback; return () => {}; },
    activeSessionRef: x.runtime.activeSessionRef,
    loadRequestID: { current: 0 },
    submitAttemptID: x.runtime.submitAttemptID,
    submitInFlight: { current: true },
    setBusy: value => reset.busy.push(value),
    setState: value => reset.state.push(value),
    setPendingAttempt: value => reset.pending.push(value),
    setQuotePreview: value => reset.quote.push(value),
    setRecipient: value => reset.recipient.push(value),
    setMultiMode: value => reset.modes.push(value),
    setAddressesExpanded: () => {},
    setExpandedModeStoreID: () => {},
    setError: value => reset.errors.push(value),
  };
  const compiled = ts.transpileModule(`const effect = ${sessionEffect}; effect;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, context)();
  subscriber(actor());
  assert.equal(reset.recipient.length, 0);
  x.renew();
  subscriber(actor("client-a", "session-2"));
  assert.equal(reset.recipient[0].mode, "SELF");
  assert.equal(reset.quote[0], null);
  assert.equal(reset.pending[0], null);
  assert.equal(context.submitAttemptID.current, 1);
  assert.equal(context.submitInFlight.current, false);
  assert.equal(reset.busy.at(-1), false);
  assert.equal(reloads, 2);
});

test("the existing actor-keyed receipt and quoted child amounts remain authoritative recovery evidence", () => {
  assert.match(source, /pendingMultiStoreAttemptKey\(actorID\)/);
  assert.match(source, /expectedTotalAmountMinor: accepted\.totalAmountMinor/);
  assert.match(source, /isTerminalMultiStoreCheckout\(checkout\)/);
  assert.match(source, /clientOrderSessionKey\(currentIdentityState\(\)\) !== activeSessionRef\.current/);
  assert.doesNotMatch(source, /hasCurrentMultiStoreActor/);
});

test("stale load after same-actor reauthentication never reads the previous pending receipt", async () => {
  assert.ok(loadCallback, "the real loading callback must be present");
  let identity = actor();
  const gate = deferred();
  const started = deferred();
  const reads = [];
  const runtime = {
    clientOrderSessionKey,
    currentIdentityState: () => identity,
    selectedCityID: "sanaa",
    loadRequestID: { current: 0 },
    setState: () => {},
    setQuotePreview: () => {},
    setError: () => {},
    authenticatedClientActorID: () => { started.resolve(); return gate.promise; },
    hasCurrentMultiStoreSession: key => key === clientOrderSessionKey(identity),
    SecureStore: { getItemAsync: async key => { reads.push(key); return null; } },
  };
  const compiled = ts.transpileModule(`const load = ${loadCallback}; load;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loading = runInNewContext(compiled, runtime)();
  await started.promise;
  identity = actor("client-a", "session-2");
  gate.resolve("client-a");
  await loading;
  assert.equal(reads.length, 0);
});

test("a session switch between render and subscription registration is recovered immediately", () => {
  assert.ok(sessionEffect);
  const x = fixture();
  x.renew();
  const events = { quotes: [], recipients: [], reloads: 0 };
  const runtime = {
    clientOrderSessionKey,
    currentIdentityState: x.runtime.currentIdentityState,
    activeSessionRef: x.runtime.activeSessionRef,
    loadRequestID: { current: 0 },
    submitAttemptID: { current: 0 },
    submitInFlight: { current: true },
    subscribeIdentitySession: () => () => {},
    load: () => { events.reloads++; },
    setBusy: () => {},
    setState: () => {},
    setPendingAttempt: () => {},
    setQuotePreview: value => events.quotes.push(value),
    setRecipient: value => events.recipients.push(value),
    setMultiMode: () => {},
    setAddressesExpanded: () => {},
    setExpandedModeStoreID: () => {},
    setError: () => {},
  };
  const compiled = ts.transpileModule(`const effect = ${sessionEffect}; effect;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, runtime)();
  assert.equal(runtime.activeSessionRef.current, clientOrderSessionKey(x.runtime.currentIdentityState()));
  assert.equal(events.quotes.length, 1);
  assert.equal(events.quotes[0], null);
  assert.equal(events.recipients[0].mode, "SELF");
  assert.equal(events.reloads, 1);
});
