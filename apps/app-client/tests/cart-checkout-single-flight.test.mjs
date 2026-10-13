import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual checkout handler with isolated dependencies; no device, API, or DB mutation.
const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/features/cart-checkout/cart-checkout.tsx"), "utf8");
const ast = ts.createSourceFile("cart-checkout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let checkoutNode;
let quoteNode;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "checkout") checkoutNode = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "quoteMatchesCheckout") quoteNode = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(checkoutNode, "checkout handler is required");
assert.ok(quoteNode, "checkout quote identity guard is required");
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None };
const runnableQuote = ts.transpileModule(quoteNode.getText(ast), { compilerOptions }).outputText;
const runnableHandler = ts.transpileModule(checkoutNode.getText(ast), { compilerOptions }).outputText;
const quoteMatchesCheckout = vm.runInNewContext(`${runnableQuote}\nquoteMatchesCheckout`);

function scenario({ accessToken, persist, submit, recover } = {}) {
  const counts = { token: 0, persist: 0, submit: 0, generatedIds: 0, pending: [], busy: [], errors: [] };
  const context = {
    checkoutSubmitting: { current: false },
    pickupMode: true,
    serviceableAddressId: undefined,
    mutationBusy: false,
    state: { kind: "ready", cart: { id: "cart-1", version: 3, lines: [{}] } },
    quote: { kind: "ready", quote: { cartId: "cart-1", storeId: "store-1", cartVersion: 3, addressId: "", fulfillmentMode: "CUSTOMER_PICKUP", promotionCode: "", totalAmountMinor: 200 } },
    internalBalanceInput: "0",
    parseMinorAmount: () => 0,
    wallet: { kind: "ready", availableMinor: 0 },
    recipient: { mode: "SELF" },
    storeId: "store-1",
    fulfillmentMode: "CUSTOMER_PICKUP",
    promotionCode: "",
    deliveryRecipientIsValid: () => true,
    checkoutRecipient: () => ({ mode: "SELF" }),
    setError: (message) => counts.errors.push(message),
    setBusy: (value) => counts.busy.push(value),
    getUsableIdentityAccessToken: async () => {
      counts.token++;
      return accessToken ? accessToken(counts.token) : "token";
    },
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: "client-1" } }),
    pendingCartCheckoutKey: (actorId, storeId) => `${actorId}:${storeId}`,
    Crypto: { randomUUID: () => String(++counts.generatedIds) },
    SecureStore: {
      setItemAsync: async (key, value) => {
        counts.persist++;
        if (persist) await persist(key, value, counts.persist);
      },
      deleteItemAsync: async () => {},
    },
    setPendingCheckout: (value) => counts.pending.push(value),
    client: () => ({
      checkoutCart: async (...args) => {
        counts.submit++;
        return submit ? submit(...args) : { order: { id: "order-1" } };
      },
    }),
    finishCheckout: async () => {},
    readOrderForCart: async () => recover ? recover() : null,
    definitiveCheckoutRejection: () => false,
    cartMutationErrorMessage: () => "retry",
    errorCode: () => "",
    refreshAfterConflict: async () => {},
    console: { error: () => {} },
  };
  const checkout = vm.runInNewContext(`${runnableQuote}\n${runnableHandler}\ncheckout`, context);
  return { checkout, counts, context };
}

test("rapid taps before session/storage awaits create just one checkout identity", async () => {
  const { checkout, counts } = scenario();
  await Promise.all([checkout(), checkout(), checkout()]);
  assert.equal(counts.token, 1);
  assert.equal(counts.persist, 1);
  assert.equal(counts.submit, 1);
  assert.equal(counts.generatedIds, 2); // one idempotency key and one correlation key
  assert.deepEqual(counts.busy, [true, false]);
});

test("session failure releases the lock before a fresh intentional attempt", async () => {
  const { checkout, counts } = scenario({ accessToken: (call) => {
    if (call === 1) throw new Error("SESSION_UNAVAILABLE");
    return "token";
  } });
  await checkout();
  await checkout();
  assert.equal(counts.token, 2);
  assert.equal(counts.persist, 1);
  assert.equal(counts.submit, 1);
  assert.deepEqual(counts.busy, [true, false, true, false]);
});

test("secure-storage failure never sends an order and releases the lock", async () => {
  const { checkout, counts } = scenario({ persist: (_, __, call) => {
    if (call === 1) throw new Error("STORAGE_UNAVAILABLE");
  } });
  await checkout();
  assert.equal(counts.submit, 0);
  await checkout();
  assert.equal(counts.persist, 2);
  assert.equal(counts.submit, 1);
  assert.deepEqual(counts.busy, [true, false, true, false]);
});

test("unknown network outcome preserves one durable attempt after rapid taps", async () => {
  const { checkout, counts } = scenario({
    submit: async () => { throw new Error("NETWORK_UNKNOWN"); },
    recover: async () => { throw new Error("READBACK_UNAVAILABLE"); },
  });
  await Promise.all([checkout(), checkout()]);
  assert.equal(counts.persist, 1);
  assert.equal(counts.submit, 1);
  assert.equal(counts.pending.length, 1);
  assert.ok(counts.errors.some((message) => message.includes("بقيت محاولة واحدة محفوظة")));
  assert.deepEqual(counts.busy, [true, false]);
});

test("quote guard rejects stale cart, store, address, fulfillment mode and promotion facts", async () => {
  const { checkout, counts, context } = scenario();
  const current = context.quote.quote;
  const staleQuotes = [
    { ...current, cartId: "another-cart" },
    { ...current, storeId: "another-store" },
    { ...current, cartVersion: 2 },
    { ...current, addressId: "another-address" },
    { ...current, fulfillmentMode: "BTHWANI_CAPTAIN" },
    { ...current, promotionCode: "OLD_COUPON" },
  ];
  for (const stale of staleQuotes) {
    context.quote = { kind: "ready", quote: stale };
    await checkout();
  }
  assert.equal(counts.token, 0, "stale quote must not start a checkout");
  assert.equal(counts.persist, 0);
  assert.equal(counts.submit, 0);
  context.quote = { kind: "ready", quote: current };
  context.promotionCode = " NEWCODE ";
  await checkout();
  assert.equal(counts.submit, 0, "edited promotion cannot use the earlier quote");
  const withCoupon = { ...current, promotionCode: "NEWCODE" };
  assert.equal(quoteMatchesCheckout(withCoupon, context.state.cart, context.storeId, "", context.fulfillmentMode, " newcode "), true);
  context.quote = { kind: "ready", quote: withCoupon };
  await checkout();
  assert.equal(counts.submit, 1, "matching recalculated quote permits one checkout");
});
