import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { paymentSplit } from "../src/features/cart-checkout/payment-selection.ts";

// Execute the actual checkout handler with isolated dependencies; no device, API, or DB mutation.
const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/features/cart-checkout/cart-checkout.tsx"), "utf8");
const ast = ts.createSourceFile("cart-checkout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let checkoutNode;
let quoteNode;
let verifiedQuoteNode;
let refreshQuoteNode;
let pendingTotalNode;
let currentActorGuardNode;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "checkout") checkoutNode = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "quoteMatchesCheckout") quoteNode = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "pendingCheckoutHasAcceptedTotal") pendingTotalNode = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "checkoutAttemptBelongsToCurrentActor") currentActorGuardNode = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "verifiedQuote") verifiedQuoteNode = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshQuote") refreshQuoteNode = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(checkoutNode, "checkout handler is required");
assert.ok(quoteNode, "checkout quote identity guard is required");
assert.ok(verifiedQuoteNode?.initializer, "visible checkout quote derivation is required");
assert.ok(refreshQuoteNode?.initializer, "quote request callback is required");
assert.ok(pendingTotalNode, "pending checkout legacy accepted-total guard is required");
assert.ok(currentActorGuardNode, "pending checkout recovery must revalidate its actor");
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None };
const runnableQuote = ts.transpileModule(quoteNode.getText(ast), { compilerOptions }).outputText;
const runnableHandler = ts.transpileModule(`${currentActorGuardNode.getText(ast)}\n${checkoutNode.getText(ast)}`, { compilerOptions }).outputText;
const quoteMatchesCheckout = vm.runInNewContext(`${runnableQuote}\nquoteMatchesCheckout`);
const pendingCheckoutHasAcceptedTotal = vm.runInNewContext(`${ts.transpileModule(pendingTotalNode.getText(ast), { compilerOptions }).outputText}\npendingCheckoutHasAcceptedTotal`);
const checkoutAttemptBelongsToCurrentActor = vm.runInNewContext(`${ts.transpileModule(currentActorGuardNode.getText(ast), { compilerOptions }).outputText}\ncheckoutAttemptBelongsToCurrentActor`);
const visibleQuoteExpression = verifiedQuoteNode.initializer.getText(ast);
const runnableVisibleQuote = ts.transpileModule(`function readVisibleQuote(readyCart, quote, storeId, pickupMode, serviceableAddressId, fulfillmentMode, appliedPromotionCode, storeAcceptingOrders = true) { return ${visibleQuoteExpression}; }`, { compilerOptions }).outputText;
const readVisibleQuote = vm.runInNewContext(`${runnableQuote}\n${runnableVisibleQuote}\nreadVisibleQuote`);

function scenario({ accessToken, persist, submit, recover, isOffline = false } = {}) {
  let actor = "client-1";
  const counts = { token: 0, persist: 0, submit: 0, deletes: 0, finish: 0, generatedIds: 0, pending: [], busy: [], errors: [] };
  const context = {
    isOffline,
    checkoutSubmitting: { current: false },
    pickupMode: true,
    serviceableAddressId: undefined,
    mutationBusy: false,
    state: { kind: "ready", cart: { id: "cart-1", version: 3, lines: [{}] } },
    quote: { kind: "ready", quote: { cartId: "cart-1", storeId: "store-1", cartVersion: 3, addressId: "", fulfillmentMode: "CUSTOMER_PICKUP", promotionCode: "", subtotalMinor: 200, discountMinor: 0, deliveryFeeMinor: 0, totalAmountMinor: 200, currency: "YER" } },
    paymentChoice: "CASH",
    paymentSplit,
    customerNote: "",
    acknowledgedDiscoveryClickForCheckout: async () => null,
    wallet: { kind: "ready", availableMinor: 0 },
    recipient: { mode: "SELF" },
    storeId: "store-1",
    storeAcceptingOrders: true,
    fulfillmentMode: "CUSTOMER_PICKUP",
    promotionCode: "",
    appliedPromotionCode: "",
    deliveryRecipientIsValid: () => true,
    checkoutRecipient: () => ({ mode: "SELF" }),
    setError: (message) => counts.errors.push(message),
    setBusy: (value) => counts.busy.push(value),
    getUsableIdentityAccessToken: async () => {
      counts.token++;
      return accessToken ? accessToken(counts.token) : "token";
    },
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    pendingCartCheckoutKey: (actorId, storeId) => `${actorId}:${storeId}`,
    Crypto: { randomUUID: () => String(++counts.generatedIds) },
    SecureStore: {
      setItemAsync: async (key, value) => {
        counts.persist++;
        if (persist) await persist(key, value, counts.persist);
      },
      deleteItemAsync: async () => { counts.deletes++; },
    },
    setPendingCheckout: (value) => counts.pending.push(value),
    client: () => ({
      checkoutCart: async (...args) => {
        counts.submit++;
        return submit ? submit(...args) : { order: { id: "order-1" } };
      },
    }),
    finishCheckout: async () => { counts.finish++; },
    readOrderForCart: async () => recover ? recover() : null,
    definitiveCheckoutRejection: () => false,
    cartMutationErrorMessage: () => "retry",
    errorCode: () => "",
    refreshAfterConflict: async () => {},
    console: { error: () => {} },
  };
  const checkout = vm.runInNewContext(`${runnableQuote}\n${runnableHandler}\ncheckout`, context);
  return { checkout, counts, context, setActor: (next) => { actor = next; } };
}

test("pending recovery stops after an actor switch during canonical order readback", () => {
  let activeActor = "client-1";
  const guard = vm.runInNewContext(`${ts.transpileModule(currentActorGuardNode.getText(ast), { compilerOptions }).outputText}\ncheckoutAttemptBelongsToCurrentActor`, {
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: activeActor } }),
  });
  assert.equal(guard("client-1"), true);
  activeActor = "client-2";
  assert.equal(guard("client-1"), false, "a recovered order/payment attempt must remain hidden from the new actor");

  const load = source.slice(source.indexOf("const load = useCallback(async () => {"), source.indexOf("  }, [finishCheckout, readOrderForCart, refreshWallet, storeId]);"));
  const orderRead = load.indexOf("await readOrderForCart(token, attempt.cartID)");
  const ownerGuard = load.indexOf("!checkoutAttemptBelongsToCurrentActor(actorID)", orderRead);
  const recoveredOrder = load.indexOf("if (existingOrder)", ownerGuard);
  const retry = load.indexOf("client().checkoutCart(token, attempt.request", ownerGuard);
  const retryReadback = load.indexOf("await readOrderForCart(token, attempt.cartID)", orderRead + 1);
  const retryReadbackGuard = load.indexOf("!checkoutAttemptBelongsToCurrentActor(actorID)", retryReadback);
  assert.ok(orderRead >= 0 && ownerGuard > orderRead && recoveredOrder > ownerGuard && retry > ownerGuard,
    "revalidate the actor after initial readback and before exposing or retrying the former actor attempt");
  assert.ok(retryReadback > retry && retryReadbackGuard > retryReadback,
    "revalidate the actor after retry readback before exposing a recovered order");
});

test("single-store checkout keeps a switched actor from seeing or clearing the prior actor's order", async () => {
  const successful = scenario({ submit: async () => {
    successful.setActor("client-2");
    return { order: { id: "prior-actor-order" } };
  } });
  await successful.checkout();
  assert.equal(successful.counts.submit, 1, "the in-flight request is not duplicated or rewritten");
  assert.equal(successful.counts.finish, 0, "the prior actor's order must not be published to the new session");
  assert.equal(successful.counts.deletes, 0, "retain the original actor's durable attempt for reconciliation");
  assert.equal(successful.counts.pending.length, 1);
  assert.match(successful.counts.errors.at(-1), /تغيّرت جلسة العميل/);

  const readback = scenario({
    submit: async () => {
      throw new Error("UNKNOWN_OUTCOME");
    },
    recover: async () => {
      readback.setActor("client-2");
      return { id: "prior-actor-order" };
    },
  });
  await readback.checkout();
  assert.equal(readback.counts.finish, 0, "recovery readback must be actor-checked before publishing");
  assert.equal(readback.counts.deletes, 0, "do not erase the prior actor's unresolved attempt");
  assert.equal(readback.counts.pending.length, 1);
  assert.match(readback.counts.errors.at(-1), /تغيّرت جلسة العميل/);
});

test("confirmed offline state never creates an order or a pending payment attempt", async () => {
  const { checkout, counts, context } = scenario({ isOffline: true });
  await checkout();
  assert.equal(counts.token, 0);
  assert.equal(counts.persist, 0);
  assert.equal(counts.submit, 0);
  assert.equal(counts.generatedIds, 0);
  assert.equal(counts.pending.length, 0);
  assert.equal(context.checkoutSubmitting.current, false);
  assert.ok(counts.errors.some((message) => message.includes("لم يُرسل الطلب")));
  context.isOffline = false;
  await checkout();
  assert.equal(counts.persist, 1);
  assert.equal(counts.submit, 1);
});

test("checkout funds the remaining cash automatically from the available wallet", async () => {
  let accepted;
  const { checkout, context } = scenario({
    submit: async (_token, request) => {
      accepted = request;
      return { order: { id: "order-wallet-mixed" } };
    },
  });
  context.wallet = { kind: "ready", availableMinor: 80 };
  context.paymentChoice = "MIXED";
  await checkout();
  assert.equal(accepted.expectedTotalAmountMinor, 200);
  assert.equal(accepted.internalBalanceAmountMinor, 80);
});

test("checkout can cover the whole amount from wallet without negative cash", async () => {
  let accepted;
  const { checkout, context } = scenario({
    submit: async (_token, request) => {
      accepted = request;
      return { order: { id: "order-wallet-full" } };
    },
  });
  context.wallet = { kind: "ready", availableMinor: 500 };
  context.paymentChoice = "WALLET";
  await checkout();
  assert.equal(accepted.internalBalanceAmountMinor, 200);
});

test("unavailable selected wallet fails before creating a payment attempt", async () => {
  const { checkout, counts, context } = scenario();
  context.wallet = { kind: "error" };
  context.paymentChoice = "WALLET";
  await checkout();
  assert.equal(counts.persist, 0);
  assert.equal(counts.submit, 0);
  assert.equal(counts.generatedIds, 0);
  assert.equal(counts.errors.length, 1);
});

test("actor switch during pending-attempt persistence never submits the previous actor payment", async () => {
  let setActor;
  const { checkout, counts, setActor: switchActor } = scenario({
    persist: async () => { switchActor("client-2"); },
  });
  setActor = switchActor;
  await checkout();
  assert.equal(counts.persist, 1);
  assert.equal(counts.deletes, 1);
  assert.equal(counts.submit, 0, "an attempt persisted for the former actor must not reach checkout");
  assert.equal(counts.pending.length, 0);
  assert.ok(counts.errors.length > 0);
  void setActor;
});
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
  assert.equal(counts.submit, 1, "unapplied draft must not invalidate a matching cash-only quote");
  assert.equal(counts.pending[0].request.promotionCode, undefined, "draft must not enter the checkout request");
  context.appliedPromotionCode = "NEWCODE";
  await checkout();
  assert.equal(counts.submit, 1, "an applied coupon requires its own matching quote");
  const withCoupon = { ...current, promotionCode: "NEWCODE" };
  assert.equal(quoteMatchesCheckout(withCoupon, context.state.cart, context.storeId, "", context.fulfillmentMode, " newcode "), true);
  context.quote = { kind: "ready", quote: withCoupon };
  await checkout();
  assert.equal(counts.submit, 2, "matching recalculated quote permits one checkout");
  assert.equal(counts.pending[1].request.promotionCode, "NEWCODE", "only the applied coupon is sent");
});

test("payment summary exposes only the quote matching the current checkout context", () => {
  const { context } = scenario();
  const derive = (quote, mode = context.fulfillmentMode, coupon = context.appliedPromotionCode) =>
    readVisibleQuote(context.state.cart, { kind: "ready", quote }, context.storeId, mode === "CUSTOMER_PICKUP", undefined, mode, coupon);
  const current = context.quote.quote;
  assert.equal(derive(current), current);
  context.promotionCode = "DRAFT_ONLY";
  assert.equal(derive(current), current, "editing an unapplied coupon must not hide the existing quote");
  for (const stale of [
    { ...current, cartId: "other-cart" },
    { ...current, storeId: "other-store" },
    { ...current, cartVersion: 4 },
    { ...current, addressId: "other-address" },
    { ...current, fulfillmentMode: "PARTNER_CAPTAIN" },
    { ...current, promotionCode: "OLD" },
  ]) {
    assert.equal(derive(stale), null);
  }
  assert.equal(derive(current, "CUSTOMER_PICKUP", "NEW"), null);
  assert.equal(readVisibleQuote(context.state.cart, { kind: "loading" }, context.storeId, true, undefined, context.fulfillmentMode, ""), null);
  assert.equal(readVisibleQuote(null, { kind: "ready", quote: current }, context.storeId, true, undefined, context.fulfillmentMode, ""), null);
});

test("malformed quote prices never authorize checkout", async () => {
  const { checkout, counts, context } = scenario();
  const current = context.quote.quote;
  for (const malformed of [
    { ...current, totalAmountMinor: -1 },
    { ...current, totalAmountMinor: 201 },
    { ...current, discountMinor: 201 },
    { ...current, deliveryFeeMinor: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    context.quote = { kind: "ready", quote: malformed };
    await checkout();
  }
  assert.equal(counts.submit, 0, "invalid or inconsistent prices must never reach order submission");
  assert.equal(counts.pending.length, 0, "invalid prices must not be persisted as accepted checkout attempts");
});

test("typing a coupon does not change the quote request until the applied coupon changes", async () => {
  const expr = refreshQuoteNode.initializer.getText(ast);
  const executable = ts.transpileModule(`const refreshQuote = ${expr};\nrefreshQuote;`, { compilerOptions }).outputText;
  const requests = [];
  const quoteStates = [];
  let dependencies = [];
  const context = {
    appliedPromotionCode: "SAVE10",
    promotionCode: "DRAFT99", // Deliberately differs: only the applied code may hit the server.
    fulfillmentMode: "CUSTOMER_PICKUP",
    pickupMode: true,
    quoteAddressID: "",
    serviceableAddressId: undefined,
    storeId: "store-1",
    storeAcceptingOrders: true,
    quoteRequestID: { current: 0 },
    setQuote: (state) => quoteStates.push(state),
    getUsableIdentityAccessToken: async () => "token",
    client: () => ({ quoteCheckout: async (_, request, version) => {
      requests.push({ request, version });
      return { quote: { cartId: request.cartId, promotionCode: request.promotionCode } };
    } }),
    useCallback: (callback, deps) => {
      dependencies = deps;
      return callback;
    },
    console: { error: () => {} },
  };
  const refreshQuote = vm.runInNewContext(executable, context);
  await refreshQuote({ id: "cart-1", version: 3, lines: [] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.promotionCode, "SAVE10");
  assert.equal(requests[0].version, 3);
  assert.equal(quoteStates.at(-1).kind, "ready");
  assert.ok(dependencies.includes("SAVE10"));
  assert.ok(!dependencies.includes("DRAFT99"));
});

test("late quote response cannot replace the quote for the latest cart version", async () => {
  const expr = refreshQuoteNode.initializer.getText(ast);
  const executable = ts.transpileModule(`const refreshQuote = ${expr};\nrefreshQuote;`, { compilerOptions }).outputText;
  const requests = [];
  const requestWaiters = [];
  const waitForRequest = (count) => requests.length >= count ? Promise.resolve() : new Promise((resolve) => { requestWaiters[count] = resolve; });
  const quoteStates = [];
  const context = {
    appliedPromotionCode: "",
    fulfillmentMode: "CUSTOMER_PICKUP",
    pickupMode: true,
    quoteAddressID: "",
    serviceableAddressId: undefined,
    storeId: "store-1",
    storeAcceptingOrders: true,
    quoteRequestID: { current: 0 },
    setQuote: (state) => quoteStates.push(state),
    getUsableIdentityAccessToken: async () => "token",
    client: () => ({ quoteCheckout: (_token, request, version) => new Promise((resolve) => {
      requests.push({ request, version, resolve });
      requestWaiters[requests.length]?.();
    }) }),
    useCallback: (callback) => callback,
    console: { error: () => {} },
  };
  const refreshQuote = vm.runInNewContext(executable, context);
  const firstStarted = waitForRequest(1);
  const oldRequest = refreshQuote({ id: "cart-1", version: 3, lines: [] });
  await firstStarted;
  const secondStarted = waitForRequest(2);
  const currentRequest = refreshQuote({ id: "cart-1", version: 4, lines: [] });
  await secondStarted;
  assert.equal(requests.length, 2);

  const currentQuote = { cartId: "cart-1", cartVersion: 4, totalAmountMinor: 240 };
  requests[1].resolve({ quote: currentQuote });
  await currentRequest;
  assert.equal(quoteStates.at(-1).kind, "ready");
  assert.equal(quoteStates.at(-1).quote, currentQuote, "the latest cart version's quote is accepted");

  requests[0].resolve({ quote: { cartId: "cart-1", cartVersion: 3, totalAmountMinor: 200 } });
  await oldRequest;
  assert.equal(quoteStates.at(-1).quote, currentQuote, "a late response for the stale cart version is ignored");
  assert.equal(context.quoteRequestID.current, 2);
});

test("cart with unavailable modifier never calls the checkout quote API", async () => {
  const callbackSource = refreshQuoteNode.initializer.getText(ast);
  const executable = ts.transpileModule(`const refreshQuote = ${callbackSource};\nrefreshQuote;`, { compilerOptions }).outputText;
  const states = [];
  let requests = 0;
  const context = {
    appliedPromotionCode: "",
    fulfillmentMode: "CUSTOMER_PICKUP",
    pickupMode: true,
    quoteAddressID: "",
    serviceableAddressId: undefined,
    storeId: "store-1",
    storeAcceptingOrders: true,
    quoteRequestID: { current: 12 },
    setQuote: (state) => states.push(state),
    getUsableIdentityAccessToken: async () => { throw new Error("no identity read for invalid cart"); },
    client: () => ({ quoteCheckout: async () => { requests++; throw new Error("invalid cart must not be quoted"); } }),
    useCallback: (callback) => callback,
    console: { error: () => {} },
  };
  const refreshQuote = vm.runInNewContext(executable, context);
  await refreshQuote({ id: "cart-1", version: 5, lines: [{ requiresReview: true }] });
  assert.equal(requests, 0);
  assert.equal(context.quoteRequestID.current, 13);
  assert.equal(states.length, 1);
  assert.equal(states[0].kind, "invalid");
});

test("previously valid quote never authorizes checkout of an invalidated modifier line", async () => {
  const { checkout, context, counts } = scenario();
  context.state.cart.lines = [{ requiresReview: true }];
  await checkout();
  assert.equal(counts.token, 0);
  assert.equal(counts.persist, 0);
  assert.equal(counts.submit, 0);
  assert.equal(readVisibleQuote(context.state.cart, context.quote, context.storeId, true, undefined, context.fulfillmentMode, ""), null);
});

test("checkout uses previously applied coupon instead of an unsubmitted draft", async () => {
  const { checkout, counts, context } = scenario();
  context.appliedPromotionCode = "SAVE10";
  context.promotionCode = "DRAFT99";
  context.quote.quote.promotionCode = "SAVE10";
  await checkout();
  assert.equal(counts.submit, 1, "the applied quote must remain eligible");
  assert.equal(counts.pending[0].request.promotionCode, "SAVE10");
  assert.equal(counts.persist, 1);
});

test("checkout persists the exact accepted quote total before submitting", async () => {
  const { checkout, counts, context } = scenario();
  const displayedTotal = context.quote.quote.totalAmountMinor;
  await checkout();
  assert.equal(counts.persist, 1);
  assert.equal(counts.submit, 1);
  assert.equal(counts.pending[0].request.expectedTotalAmountMinor, displayedTotal);
});

test("legacy pending checkout cannot resubmit without accepted amount", () => {
  const attempt = (amount) => ({ request: { expectedTotalAmountMinor: amount } });
  for (const unconfirmed of [undefined, null, 0, -1, 1.5, NaN, Infinity, "200"]) {
    assert.equal(pendingCheckoutHasAcceptedTotal(attempt(unconfirmed)), false);
  }
  assert.equal(pendingCheckoutHasAcceptedTotal(attempt(200)), true);
  assert.equal(pendingCheckoutHasAcceptedTotal(attempt(Number.MAX_SAFE_INTEGER)), true);

  const loadStart = source.indexOf("const load = useCallback(async () => {");
  const legacyGuard = source.indexOf("if (!pendingCheckoutHasAcceptedTotal(attempt))", loadStart);
  const submitAfterGuard = source.indexOf("client().checkoutCart(token, attempt.request", loadStart);
  assert.ok(loadStart >= 0 && legacyGuard > loadStart && submitAfterGuard > legacyGuard,
    "check the persisted amount before any recovery submission");
  assert.match(source.slice(legacyGuard, submitAfterGuard), /setBusy\(false\)/,
    "a withheld legacy retry must release its loading state");
  assert.doesNotMatch(source.slice(legacyGuard, submitAfterGuard), /deleteItemAsync/,
    "a legacy pending attempt must not be silently erased");
});

test("checkout quote explains unavailable, invalid and out-of-scope offers without submitting an order", async () => {
  const helper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "quoteFailureMessage");
  assert.ok(helper, "quote error message must be defined in the real checkout");
  const code = ts.transpileModule(helper.getText(ast), { compilerOptions }).outputText;
  const quoteFailureMessage = vm.runInNewContext(
    "function errorCode(error) { return error?.code ?? ''; }\n" + code + "\nquoteFailureMessage",
  );
  assert.match(quoteFailureMessage({ code: "PROMOTION_UNAVAILABLE" }, "SAVE10"), /العرض غير متاح/);
  assert.match(quoteFailureMessage({ code: "INVALID_INPUT" }, "SAVE10"), /رمز العرض غير صالح/);
  assert.match(quoteFailureMessage({ code: "UNSERVICEABLE" }, ""), /العنوان/);
  assert.match(quoteFailureMessage({ code: "FULFILLMENT_MODE_UNAVAILABLE" }, ""), /طريقة الاستلام/);
  assert.match(quoteFailureMessage({ code: "WLT_DELIVERY_FEE_UNAVAILABLE" }, ""), /رسوم التوصيل/);
  assert.match(quoteFailureMessage({ code: "UNKNOWN" }, ""), /تعذر حساب الإجمالي/);

  const calls = [];
  const callback = ts.transpileModule(
    "function errorCode(error) { return error?.code ?? ''; }\n" + code + "\nconst refreshQuote = " + refreshQuoteNode.initializer.getText(ast) + "; refreshQuote;",
    { compilerOptions },
  ).outputText;
  const refreshQuote = vm.runInNewContext(callback, {
    appliedPromotionCode: "SAVE10",
    pickupMode: true,
    fulfillmentMode: "CUSTOMER_PICKUP",
    quoteAddressID: "",
    serviceableAddressId: undefined,
    storeId: "store-1",
    storeAcceptingOrders: true,
    quoteRequestID: { current: 0 },
    setQuote: (state) => calls.push(state),
    getUsableIdentityAccessToken: async () => "token",
    client: () => ({ quoteCheckout: async () => { throw { code: "PROMOTION_UNAVAILABLE" }; } }),
    useCallback: (fn) => fn,
    console: { error: () => {} },
  });
  await refreshQuote({ id: "cart-1", version: 1, lines: [] });
  assert.equal(calls.at(-1).kind, "error");
  assert.match(calls.at(-1).message, /العرض غير متاح/);
});
