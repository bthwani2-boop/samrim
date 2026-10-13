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
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "checkout") checkoutNode = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(checkoutNode, "checkout handler is required");
const runnableHandler = ts.transpileModule(checkoutNode.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function scenario({ accessToken, persist, submit, recover } = {}) {
  const counts = { token: 0, persist: 0, submit: 0, generatedIds: 0, pending: [], busy: [], errors: [] };
  const context = {
    checkoutSubmitting: { current: false },
    pickupMode: true,
    serviceableAddressId: undefined,
    mutationBusy: false,
    state: { kind: "ready", cart: { id: "cart-1", version: 3, lines: [{}] } },
    quote: { kind: "ready", quote: { cartVersion: 3, addressId: "", totalAmountMinor: 200 } },
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
  const checkout = vm.runInNewContext(`${runnableHandler}\ncheckout`, context);
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
