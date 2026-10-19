import assert from "node:assert/strict";
import test from "node:test";
import { matchesOrderFilters } from "./order-list-filter.ts";

const order = (state, fulfillmentMode = "BTHWANI_CAPTAIN") => ({ state, fulfillmentMode });

test("all shows every order state and either fulfillment without hiding history", () => {
  for (const state of ["CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERED", "PICKED_UP", "REJECTED", "CANCELLED", "DELIVERY_FAILED"]) {
    assert.equal(matchesOrderFilters(order(state), "all", "all"), true, state);
  }
});

test("completed and stopped states never appear as active", () => {
  for (const state of ["DELIVERED", "PICKED_UP", "REJECTED", "CANCELLED", "DELIVERY_FAILED"]) {
    assert.equal(matchesOrderFilters(order(state), "all", "active"), false, state);
  }
  for (const state of ["CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY"]) {
    assert.equal(matchesOrderFilters(order(state), "all", "active"), true, state);
  }
});

test("completed includes delivery and customer pickup; stopped includes refusals and failures", () => {
  assert.equal(matchesOrderFilters(order("DELIVERED"), "all", "completed"), true);
  assert.equal(matchesOrderFilters(order("PICKED_UP", "CUSTOMER_PICKUP"), "all", "completed"), true);
  for (const state of ["REJECTED", "CANCELLED", "DELIVERY_FAILED"]) {
    assert.equal(matchesOrderFilters(order(state), "all", "stopped"), true, state);
    assert.equal(matchesOrderFilters(order(state), "all", "completed"), false, state);
  }
});

test("mode and status filters compose without broadening store pickup into delivery", () => {
  assert.equal(matchesOrderFilters(order("PICKED_UP", "CUSTOMER_PICKUP"), "delivery", "completed"), false);
  assert.equal(matchesOrderFilters(order("PICKED_UP", "CUSTOMER_PICKUP"), "pickup", "completed"), true);
  assert.equal(matchesOrderFilters(order("DELIVERED", "PARTNER_CAPTAIN"), "delivery", "completed"), true);
  assert.equal(matchesOrderFilters(order("CREATED", "BTHWANI_CAPTAIN"), "pickup", "all"), false);
});
