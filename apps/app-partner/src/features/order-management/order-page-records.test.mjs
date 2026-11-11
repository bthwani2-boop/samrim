import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { mergeOrderPageRecords, tryAcquireOrderAction } from "./order-page-records.ts";

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
