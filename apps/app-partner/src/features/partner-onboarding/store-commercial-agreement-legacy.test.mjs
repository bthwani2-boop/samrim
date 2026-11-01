import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHistoricalCommissionReadback } from "./store-commercial-agreement-legacy.ts";

const old = Object.freeze({
  agreementId: "agreement-1", storeId: "store-1", partnerActorId: "owner-1",
  agreementVersion: 1, status: "ACTIVE",
  rates: [{ fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0 }],
});

test("decided legacy commission-only agreement remains readable without recurring charge terms", () => {
  const normalized = normalizeHistoricalCommissionReadback(old);
  assert.equal(normalized.commercialModel, "COMMISSION");
  assert.equal(normalized.recurringAmountMinor, 0);
  assert.equal(normalized.billingPeriod, "NONE");
  assert.equal(normalized.renewalPolicy, "NONE");
  assert.equal(normalized.historicalCommissionReadback, true);
  assert.equal(normalized.storeId, old.storeId);
  assert.equal(normalized.partnerActorId, old.partnerActorId);
  assert.equal(normalized.status, "ACTIVE");
  assert.equal(Object.hasOwn(old, "commercialModel"), false, "never change the source response");
});

test("incomplete new proposals and partner-accepted terms are never invented as commission", () => {
  for (const status of ["PROPOSED", "PARTNER_ACCEPTED"]) {
    const value = {...old, status};
    assert.equal(normalizeHistoricalCommissionReadback(value), value);
  }
});

test("explicit model, partial billing and malformed legacy rates are not overridden", () => {
  for (const value of [
    {...old, commercialModel: "SUBSCRIPTION", recurringAmountMinor: 20000},
    {...old, billingPeriod: "MONTHLY"},
    {...old, rates: []},
    {...old, rates: null},
    {...old, status: "AWAITING_PAYMENT"},
  ]) assert.equal(normalizeHistoricalCommissionReadback(value), value);
});
