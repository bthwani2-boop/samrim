import assert from "node:assert/strict";
import { test } from "node:test";
import { isOwnCustomerWalletResponse } from "./customer-wallet-readback.ts";

const own = (actorId = "customer-a") => ({
  state: { actorType: "customer", actorId, currency: "YER" },
  fundingIntents: [],
});

const intent = (overrides = {}) => ({
  actorType: "customer", actorId: "customer-a", fundingPurpose: "CUSTOMER_TOPUP",
  currency: "YER", ...overrides,
});

test("accepts only an owner-scoped customer wallet and its own funding records", () => {
  assert.equal(isOwnCustomerWalletResponse(own(), "customer-a"), true);
  assert.equal(isOwnCustomerWalletResponse({ ...own(), fundingIntents: [intent()] }, "customer-a"), true);
});

test("rejects a wallet for another actor, role, or currency", () => {
  assert.equal(isOwnCustomerWalletResponse(own(), "customer-b"), false);
  assert.equal(isOwnCustomerWalletResponse({ ...own(), state: { ...own().state, actorType: "captain" } }, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse({ ...own(), state: { ...own().state, currency: "USD" } }, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse(own(), ""), false);
});

test("rejects mixed-actor or wrong-purpose wallet history", () => {
  assert.equal(isOwnCustomerWalletResponse({ ...own(), fundingIntents: [intent({ actorId: "customer-b" })] }, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse({ ...own(), fundingIntents: [intent({ actorType: "captain" })] }, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse({ ...own(), fundingIntents: [intent({ fundingPurpose: "CAPTAIN_TOPUP" })] }, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse({ ...own(), fundingIntents: [intent(), intent({ currency: "USD" })] }, "customer-a"), false);
});

test("malformed or incomplete responses cannot appear as verified balances", () => {
  assert.equal(isOwnCustomerWalletResponse(null, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse({ state: null, fundingIntents: [] }, "customer-a"), false);
  assert.equal(isOwnCustomerWalletResponse({ state: own().state, fundingIntents: null }, "customer-a"), false);
});
