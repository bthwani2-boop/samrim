import assert from "node:assert/strict";
import test from "node:test";
import { isPartialOrderListEmpty, matchesOrderFilters, matchesOrderStatus } from "./order-list-filter.ts";

const makeOrder = (state, fulfillmentMode) => ({ state, fulfillmentMode });
const fulfillmentModes = {
  bthwani: "BTHWANI_CAPTAIN",
  store: "PARTNER_CAPTAIN",
  pickup: "CUSTOMER_PICKUP",
};

test("all fulfillment modes keep active, finished and cancelled history visible", () => {
  for (const state of ["CREATED", "PREPARING", "IN_CUSTODY", "DELIVERED", "PICKED_UP", "CANCELLED", "REJECTED", "DELIVERY_FAILED"]) {
    for (const mode of Object.values(fulfillmentModes)) {
      assert.equal(matchesOrderFilters(makeOrder(state, mode), "all"), true, state + " " + mode);
    }
  }
});

test("each fulfillment filter selects exactly one of the three methods", () => {
  for (const [selected, mode] of Object.entries(fulfillmentModes)) {
    for (const [filter, expectedMode] of Object.entries(fulfillmentModes)) {
      assert.equal(matchesOrderFilters(makeOrder("CREATED", mode), filter), mode === expectedMode, selected + " / " + filter);
    }
  }
});

test("store delivery does not disappear or merge with Bthwani delivery in any order state", () => {
  for (const state of ["CREATED", "PREPARING", "IN_CUSTODY", "DELIVERED", "CANCELLED", "REJECTED", "DELIVERY_FAILED"]) {
    const store = makeOrder(state, "PARTNER_CAPTAIN");
    assert.equal(matchesOrderFilters(store, "store"), true, state);
    assert.equal(matchesOrderFilters(store, "bthwani"), false, state);
    assert.equal(matchesOrderFilters(store, "pickup"), false, state);
  }
});

test("store pickup shows only pickup orders, including cancelled and completed", () => {
  assert.equal(matchesOrderFilters(makeOrder("PICKED_UP", "CUSTOMER_PICKUP"), "pickup"), true);
  assert.equal(matchesOrderFilters(makeOrder("CANCELLED", "CUSTOMER_PICKUP"), "pickup"), true);
  assert.equal(matchesOrderFilters(makeOrder("CREATED", "BTHWANI_CAPTAIN"), "pickup"), false);
});

test("active, completed and cancelled order tabs partition order states without losing history", () => {
  const active = ["CREATED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "IN_CUSTODY", "CAPTAIN_ASSIGNED"];
  const completed = ["DELIVERED", "PICKED_UP"];
  const cancelled = ["CANCELLED", "REJECTED", "DELIVERY_FAILED"];
  for (const state of [...active, ...completed, ...cancelled]) {
    assert.equal(matchesOrderStatus(state, "all"), true, state);
    const matches = ["active", "completed", "cancelled"].filter((filter) => matchesOrderStatus(state, filter));
    assert.equal(matches.length, 1, state);
    assert.equal(matches[0], completed.includes(state) ? "completed" : cancelled.includes(state) ? "cancelled" : "active");
  }
});

test("terminal order states remain visible for the correct fulfillment mode", () => {
  for (const state of ["CANCELLED", "REJECTED", "DELIVERY_FAILED", "DELIVERED", "PICKED_UP"]) {
    for (const [filter, mode] of Object.entries(fulfillmentModes)) {
      assert.equal(matchesOrderFilters(makeOrder(state, mode), filter), true, state + " " + filter);
    }
  }
});


test("an empty loaded page with a cursor is only a partial empty state", () => {
  assert.equal(isPartialOrderListEmpty(0, "older-orders-cursor"), true);
});

test("an empty order history without a cursor is a true empty state", () => {
  assert.equal(isPartialOrderListEmpty(0, ""), false);
});

test("visible loaded orders are not an empty state even when older pages remain", () => {
  assert.equal(isPartialOrderListEmpty(1, "older-orders-cursor"), false);
});
