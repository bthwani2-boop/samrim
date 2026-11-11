import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { isCurrentOrderListRequest, mergeOrderPageRecords, tryAcquireOrderAction } from "./order-page-records.ts";

test("appending a page retains earlier assignment and offer readbacks", () => {
  const firstPage = { order1: { state: "assigned" } };
  const secondPage = { order2: { state: "in_custody" } };
  assert.deepEqual(mergeOrderPageRecords(firstPage, secondPage, true), { ...firstPage, ...secondPage });
  assert.deepEqual(mergeOrderPageRecords(firstPage, {}, true), firstPage);
  assert.deepEqual(firstPage, { order1: { state: "assigned" } });
});

test("fresh owner readback replaces stale sidecars", () => {
  const previous = { order1: "old", order2: "stale" };
  assert.deepEqual(mergeOrderPageRecords(previous, { order1: "current" }, false), { order1: "current" });
  assert.deepEqual(mergeOrderPageRecords(previous, {}, false), {});
});

test("a second same-order tap is rejected synchronously until the first action settles", () => {
  const locks = new Set();
  const release = tryAcquireOrderAction(locks, "order-1");
  assert.equal(typeof release, "function");
  assert.equal(tryAcquireOrderAction(locks, "order-1"), null);
  const otherRelease = tryAcquireOrderAction(locks, "order-2");
  assert.equal(typeof otherRelease, "function");
  release();
  assert.equal(typeof tryAcquireOrderAction(locks, "order-1"), "function");
});
const orderManagementSource = readFileSync(new URL("./order-management.tsx", import.meta.url), "utf8");

function realPartnerOrderAction(name, context) {
  const prefix = "  async function " + name + "(";
  const start = orderManagementSource.indexOf(prefix);
  assert.notEqual(start, -1, name + " must exist in the real Order Management screen");
  const following = orderManagementSource.slice(start + prefix.length);
  const boundary = /\n  (?:async )?function [A-Za-z][A-Za-z0-9]*\(|\n  return \(/.exec(following);
  assert.ok(boundary, name + " must end at the next local action or screen");
  const actionSource = orderManagementSource.slice(start, start + prefix.length + boundary.index);
  const compiled = stripTypeScriptTypes(actionSource);
  return runInNewContext(compiled + "\n" + name + ";", context);
}

const guardedOrderActions = [
  { name: "proposeAdjustment", state: "PARTNER_ACCEPTED", args: (order) => [order, "line-1", "REMOVE_ITEM"] },
  { name: "confirmStorePickup", state: "READY_FOR_PICKUP", args: (order) => [order] },
  { name: "confirmStoreCaptainCashHandoff", state: "DELIVERED", mode: "PARTNER_CAPTAIN", args: (order) => [order] },
  { name: "confirmHandoff", state: "IN_CUSTODY", args: (order) => [order, { id: "assignment-1", handoff: { state: "pending", version: 2 } }] },
  { name: "dispatchToStoreCaptain", state: "READY_FOR_DISPATCH", mode: "PARTNER_CAPTAIN", args: (order) => [order, "captain-1"] },
];

async function checkSingleFlightOrderMutation(action, shouldFail) {
  const order = {
    id: "order-1",
    storeId: "store-1",
    version: 7,
    state: action.state,
    fulfillmentMode: action.mode ?? "CUSTOMER_PICKUP",
    storeCashHandoffState: "AWAITING_STORE_HANDOFF",
  };
  const orderActionLocks = { current: new Set() };
  let firstAttempt;
  const firstResponse = new Promise((resolve, reject) => { firstAttempt = { resolve, reject }; });
  let writes = 0;
  let readbacks = 0;
  let finishReadback;
  const blockedReadback = shouldFail ? new Promise((resolve) => { finishReadback = resolve; }) : null;
  const request = () => {
    writes += 1;
    return writes === 1 ? firstResponse : Promise.resolve({ order, offer: { state: "offered" } });
  };
  const fakeClient = {
    proposePartnerOrderAdjustment: request,
    transitionStoreOrder: request,
    confirmPartnerCaptainCashHandoff: request,
    confirmCaptainStoreHandoff: request,
    createPartnerStoreCaptainDispatchOffer: request,
  };
  const context = {
    busy: "",
    loading: false,
    orderActionLocks,
    tryAcquireOrderAction,
    setBusy: () => {},
    setError: () => {},
    getUsableIdentityAccessToken: async () => "test-token",
    client: () => fakeClient,
    load: async () => { readbacks += 1; if (blockedReadback) await blockedReadback; },
    canFulfillOrder: () => true,
    unreadScope: "current-session",
    currentPartnerSessionKey: () => "current-session",
    requestScopeKey: "current-session",
    activeScopeKey: { current: "current-session" },
    setOrders: () => {},
    setAdjustmentQuantities: () => {},
    pickupCodes: { "order-1": "123456" },
    toAsciiDigits: (value) => value,
    setPickupCodes: () => {},
    dispatchOffers: {},
    setDispatchOffers: () => {},
    console: { error: () => {} },
  };
  const callback = realPartnerOrderAction(action.name, context);
  const firstCall = callback(...action.args(order));
  const secondCall = callback(...action.args(order));
  assert.equal(orderActionLocks.current.has(order.id), true, action.name + " must lock synchronously");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1, action.name + " must not issue two same-order writes before React rerenders");
  assert.equal(orderActionLocks.current.has(order.id), true, action.name + " must hold its lock until settled");
  if (shouldFail) {
    firstAttempt.reject(new Error("connection lost after possible write"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readbacks, 1, action.name + " must reread canonical DSH state before an uncertain retry");
    assert.equal(orderActionLocks.current.has(order.id), true, action.name + " must hold lock during recovery");
    await callback(...action.args(order));
    assert.equal(writes, 1, action.name + " must refuse another write while owner readback is pending");
    finishReadback();
  } else firstAttempt.resolve({ order, offer: { state: "offered" } });
  await Promise.all([firstCall, secondCall]);
  assert.equal(orderActionLocks.current.size, 0, action.name + " must release after " + (shouldFail ? "error" : "success"));
  await callback(...action.args(order));
  assert.equal(writes, 2, action.name + " must permit a fresh explicit attempt after settling");
  assert.equal(orderActionLocks.current.size, 0, action.name + " must release its retry lock");
}

test("real Partner Order callbacks suppress simultaneous same-order adjustment, pickup, cash, custody and dispatch writes", async () => {
  for (const action of guardedOrderActions) await checkSingleFlightOrderMutation(action, false);
});

test("real Partner Order callbacks release each action lock after an ambiguous failed write", async () => {
  for (const action of guardedOrderActions) await checkSingleFlightOrderMutation(action, true);
});


test("Partner Order canonical refresh evicts old Captain sidecars but later pages retain previous sidecars", async () => {
  const prefix = "  const load = useCallback(";
  const suffix = "\n  }, [canFulfillOrder, filter, normalizedSearch, requestScopeKey, requestedStoreIDs, targetOrderId, unreadScope]);";
  const start = orderManagementSource.indexOf(prefix);
  const end = orderManagementSource.indexOf(suffix, start);
  assert.ok(start >= 0 && end > start, "the production Order load callback must be present");
  const compiled = stripTypeScriptTypes(orderManagementSource.slice(start, end + suffix.length));

  for (const append of [false, true]) {
    let listReads = 0;
    let sidecarReads = 0;
    let orders = [{ id: "previous-order", storeId: "store-1" }];
    let assignments = { "previous-order": { id: "previous-assignment" } };
    let captainChoices = { "store-1": [{ actorId: "previous-captain", label: "previous" }] };
    let dispatchOffers = { "previous-order": { state: "offered" } };
    const context = {
      useCallback: (callback) => callback,
      unreadScope: "session-current",
      currentPartnerSessionKey: () => "session-current",
      requestScopeKey: "scope-current",
      activeScopeKey: { current: "scope-current" },
      loadGeneration: { current: 0 },
      requestedStoreIDs: ["store-1"],
      filter: "ACTIVE",
      normalizedSearch: "",
      targetOrderId: "",
      queueFilters: [{ key: "ACTIVE", states: ["PARTNER_ACCEPTED"] }],
      canFulfillOrder: () => true,
      getUsableIdentityAccessToken: async () => "test-token",
      isCurrentOrderListRequest,
      mergeOrderPageRecords,
      setOrders: (update) => { orders = update(orders); },
      setAssignments: (update) => { assignments = update(assignments); },
      setStoreCaptainsByStore: (update) => { captainChoices = update(captainChoices); },
      setDispatchOffers: (update) => { dispatchOffers = update(dispatchOffers); },
      setAttention: () => {},
      setCursor: () => {},
      setHasMore: () => {},
      setLoading: () => {},
      setLoadingMore: () => {},
      setError: () => {},
      setSidecarError: () => {},
      client: () => ({
        listPartnerOrders: async () => {
          listReads++;
          return { orders: [], attention: { newOrders: 0, awaitingDispatch: 0, deliveryRecovery: 0 }, nextCursor: null };
        },
        listPartnerStoreCaptainMemberships: async () => { sidecarReads++; throw new Error("No eligible Orders"); },
        readStoreCaptainAssignment: async () => { sidecarReads++; throw new Error("No eligible Orders"); },
        readPartnerStoreCaptainDispatchOffer: async () => { sidecarReads++; throw new Error("No eligible Orders"); },
      }),
      console: { error: () => {} },
    };
    const load = runInNewContext(compiled + "\nload;", context);
    await load(append ? { append: true, cursor: "next-page" } : {});
    assert.equal(listReads, 1);
    assert.equal(sidecarReads, 0, "a page with no Captain work must not fetch sidecars");
    assert.equal(orders.length, append ? 1 : 0, "canonical page append/replace semantics");
    assert.deepEqual(JSON.parse(JSON.stringify(assignments)), append ? { "previous-order": { id: "previous-assignment" } } : {}, "assignment sidecars must obey append/replace");
    assert.deepEqual(JSON.parse(JSON.stringify(captainChoices)), append ? { "store-1": [{ actorId: "previous-captain", label: "previous" }] } : {}, "membership sidecars must obey append/replace");
    assert.deepEqual(JSON.parse(JSON.stringify(dispatchOffers)), append ? { "previous-order": { state: "offered" } } : {}, "dispatch offer sidecars must obey append/replace");
  }
});

test("Partner Order mutations cannot dispatch after the Identity session or Store scope switches during token acquisition", async () => {
  const actions = [
    { name: "transition", state: "CREATED", args: (order) => [order, "PARTNER_ACCEPTED"] },
    ...guardedOrderActions,
  ];
  for (const changedDimension of ["identity-session", "store-scope"]) {
    for (const action of actions) {
      const order = {
        id: "order-1",
        storeId: "store-1",
        version: 7,
        state: action.state,
        fulfillmentMode: action.mode ?? "CUSTOMER_PICKUP",
        storeCashHandoffState: "AWAITING_STORE_HANDOFF",
      };
      let currentSession = "session-a";
      const activeScopeKey = { current: "scope-a" };
      const orderActionLocks = { current: new Set() };
      let releaseToken;
      const pendingToken = new Promise((resolve) => { releaseToken = resolve; });
      let writes = 0;
      let readbacks = 0;
      const countWrite = async () => {
        writes += 1;
        return { order, offer: { state: "offered" } };
      };
      const context = {
        busy: "",
        loading: false,
        orderActionLocks,
        tryAcquireOrderAction,
        setBusy: () => {},
        setError: () => {},
        getUsableIdentityAccessToken: () => pendingToken,
        currentPartnerSessionKey: () => currentSession,
        unreadScope: "session-a",
        requestScopeKey: "scope-a",
        activeScopeKey,
        client: () => ({
          transitionStoreOrder: countWrite,
          proposePartnerOrderAdjustment: countWrite,
          confirmPartnerCaptainCashHandoff: countWrite,
          confirmCaptainStoreHandoff: countWrite,
          createPartnerStoreCaptainDispatchOffer: countWrite,
        }),
        load: async () => { readbacks += 1; },
        canFulfillOrder: () => true,
        setOrders: () => {},
        setAdjustmentQuantities: () => {},
        pickupCodes: { "order-1": "123456" },
        toAsciiDigits: (value) => value,
        setPickupCodes: () => {},
        dispatchOffers: {},
        setDispatchOffers: () => {},
        console: { error: () => {} },
      };
      const mutate = realPartnerOrderAction(action.name, context);
      const running = mutate(...action.args(order));
      assert.equal(orderActionLocks.current.has(order.id), true);
      if (changedDimension === "identity-session") currentSession = "session-b";
      else activeScopeKey.current = "scope-b";
      releaseToken("token-issued-for-old-session");
      await running;
      assert.equal(writes, 0, action.name + " must not send an Order mutation after " + changedDimension + " changes");
      assert.equal(readbacks, 0, action.name + " must not consume stale Order readback after " + changedDimension + " changes");
      assert.equal(orderActionLocks.current.size, 0, action.name + " must release its lock after abort");
    }
  }
});


test("late successful Partner Order responses do not update another Identity session or Store scope", async () => {
  for (const change of ["identity-session", "store-scope"]) {
    for (const action of [
      { name: "proposeAdjustment", state: "PARTNER_ACCEPTED", args: (order) => [order, "line-1", "REMOVE_ITEM"] },
      { name: "confirmStorePickup", state: "READY_FOR_PICKUP", args: (order) => [order] },
      { name: "dispatchToStoreCaptain", state: "READY_FOR_DISPATCH", mode: "PARTNER_CAPTAIN", args: (order) => [order, "captain-1"] },
    ]) {
      const order = {
        id: "order-1", storeId: "store-1", version: 1, state: action.state,
        fulfillmentMode: action.mode ?? "CUSTOMER_PICKUP",
      };
      let currentSession = "session-a";
      const activeScopeKey = { current: "scope-a" };
      const orderActionLocks = { current: new Set() };
      let completeWrite;
      const pendingWrite = new Promise((resolve) => { completeWrite = resolve; });
      let writes = 0;
      let staleUIUpdates = 0;
      let readbacks = 0;
      const sendWrite = () => { writes++; return pendingWrite; };
      const context = {
        busy: "", loading: false, orderActionLocks, tryAcquireOrderAction,
        setBusy: () => {}, setError: () => {},
        getUsableIdentityAccessToken: async () => "token-a",
        currentPartnerSessionKey: () => currentSession,
        unreadScope: "session-a",
        requestScopeKey: "scope-a",
        activeScopeKey,
        client: () => ({
          proposePartnerOrderAdjustment: sendWrite,
          transitionStoreOrder: sendWrite,
          createPartnerStoreCaptainDispatchOffer: sendWrite,
        }),
        load: async () => { readbacks++; },
        canFulfillOrder: () => true,
        setOrders: () => { staleUIUpdates++; },
        setAdjustmentQuantities: () => { staleUIUpdates++; },
        pickupCodes: { "order-1": "123456" },
        toAsciiDigits: (value) => value,
        setPickupCodes: () => { staleUIUpdates++; },
        dispatchOffers: {},
        setDispatchOffers: () => { staleUIUpdates++; },
        console: { error: () => {} },
      };
      const mutate = realPartnerOrderAction(action.name, context);
      const inFlight = mutate(...action.args(order));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(writes, 1, action.name + " should have started under the old session");
      if (change === "identity-session") currentSession = "session-b";
      else activeScopeKey.current = "scope-b";
      completeWrite({ order, offer: { state: "offered" } });
      await inFlight;
      assert.equal(staleUIUpdates, 0, action.name + " cannot publish late result after " + change);
      assert.equal(readbacks, 0, action.name + " cannot refresh stale Order scope after " + change);
      assert.equal(orderActionLocks.current.size, 0);
    }
  }
});


test("callbacks captured from a former Partner scope cannot start a new Order action", async () => {
  const actions = [
    { name: "transition", state: "CREATED", args: (order) => [order, "PARTNER_ACCEPTED"] },
    ...guardedOrderActions,
  ];
  for (const change of ["identity-session", "store-scope"]) {
    for (const action of actions) {
      const order = {
        id: "order-1", storeId: "store-1", version: 7, state: action.state,
        fulfillmentMode: action.mode ?? "CUSTOMER_PICKUP",
        storeCashHandoffState: "AWAITING_STORE_HANDOFF",
      };
      const locks = { current: new Set() };
      let tokenRequests = 0;
      let busyUpdates = 0;
      let writes = 0;
      const sendWrite = async () => { writes++; return { order, offer: {} }; };
      const context = {
        busy: "", loading: false,
        orderActionLocks: locks,
        tryAcquireOrderAction,
        currentPartnerSessionKey: () => change === "identity-session" ? "session-b" : "session-a",
        unreadScope: "session-a",
        requestScopeKey: "scope-a",
        activeScopeKey: { current: change === "store-scope" ? "scope-b" : "scope-a" },
        setBusy: () => { busyUpdates++; },
        setError: () => {},
        getUsableIdentityAccessToken: async () => { tokenRequests++; return "old-token"; },
        client: () => ({
          transitionStoreOrder: sendWrite,
          proposePartnerOrderAdjustment: sendWrite,
          confirmPartnerCaptainCashHandoff: sendWrite,
          confirmCaptainStoreHandoff: sendWrite,
          createPartnerStoreCaptainDispatchOffer: sendWrite,
        }),
        load: async () => {},
        canFulfillOrder: () => true,
        setOrders: () => {},
        setAdjustmentQuantities: () => {},
        pickupCodes: { "order-1": "123456" },
        toAsciiDigits: (value) => value,
        setPickupCodes: () => {},
        dispatchOffers: {},
        setDispatchOffers: () => {},
        console: { error: () => {} },
      };
      await realPartnerOrderAction(action.name, context)(...action.args(order));
      assert.equal(tokenRequests, 0, action.name + " must not obtain a token for a stale " + change);
      assert.equal(writes, 0, action.name + " must not issue a stale write");
      assert.equal(busyUpdates, 0, action.name + " must not update new session busy state");
      assert.equal(locks.current.size, 0, action.name + " must not acquire an obsolete lock");
    }
  }
});
