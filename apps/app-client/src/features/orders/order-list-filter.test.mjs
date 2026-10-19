import assert from "node:assert/strict";
import test from "node:test";
import { matchesOrderFilters } from "./order-list-filter.ts";

const makeOrder = (state, fulfillmentMode) => ({ state, fulfillmentMode });

test("all fulfillment modes keep active, finished and cancelled history visible", () => {
  for (const state of ["CREATED", "PREPARING", "IN_CUSTODY", "DELIVERED", "PICKED_UP", "CANCELLED", "REJECTED", "DELIVERY_FAILED"]) {
    for (const mode of ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]) {
      assert.equal(matchesOrderFilters(makeOrder(state, mode), "all"), true, state + " " + mode);
    }
  }
});

test("delivery includes platform and partner couriers, never store pickup", () => {
  assert.equal(matchesOrderFilters(makeOrder("DELIVERED", "BTHWANI_CAPTAIN"), "delivery"), true);
  assert.equal(matchesOrderFilters(makeOrder("CANCELLED", "PARTNER_CAPTAIN"), "delivery"), true);
  assert.equal(matchesOrderFilters(makeOrder("PICKED_UP", "CUSTOMER_PICKUP"), "delivery"), false);
});

test("store pickup shows only pickup orders, including cancelled and completed", () => {
  assert.equal(matchesOrderFilters(makeOrder("PICKED_UP", "CUSTOMER_PICKUP"), "pickup"), true);
  assert.equal(matchesOrderFilters(makeOrder("CANCELLED", "CUSTOMER_PICKUP"), "pickup"), true);
  assert.equal(matchesOrderFilters(makeOrder("CREATED", "BTHWANI_CAPTAIN"), "pickup"), false);
});

test("removing the status tabs never silently hides a terminal status", () => {
  for (const state of ["CANCELLED", "REJECTED", "DELIVERY_FAILED", "DELIVERED", "PICKED_UP"]) {
    assert.equal(matchesOrderFilters(makeOrder(state, "BTHWANI_CAPTAIN"), "delivery"), true, state);
  }
});
