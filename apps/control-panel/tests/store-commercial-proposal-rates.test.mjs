import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesProposedStoreAgreement, sameStoreCommercialRates, storeCommercialRatesForProposal } from "../src/features/partner-onboarding/store-commercial-proposal-rates.ts";

const modes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];
test("commission proposals can negotiate different per-mode rates", () => {
  const rates = storeCommercialRatesForProposal(modes, {
    BTHWANI_CAPTAIN: "10.25", PARTNER_CAPTAIN: "7.50", CUSTOMER_PICKUP: "0",
  }, "COMMISSION");
  assert.deepEqual(rates, [
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 1025 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 750 },
    { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 },
  ]);
});
test("subscription explicitly clears product commission without changing draft values", () => {
  const draft = { BTHWANI_CAPTAIN: "12.5", PARTNER_CAPTAIN: "7", CUSTOMER_PICKUP: "4" };
  assert.deepEqual(storeCommercialRatesForProposal(modes, draft, "SUBSCRIPTION"),
    modes.map(fulfillmentMode => ({ fulfillmentMode, commissionRateBps: 0 })));
  assert.equal(draft.BTHWANI_CAPTAIN, "12.5");
});
test("retired hybrid model is rejected even with positive commission", () => {
  assert.equal(storeCommercialRatesForProposal(modes, {
    BTHWANI_CAPTAIN: "0", PARTNER_CAPTAIN: "1", CUSTOMER_PICKUP: "0",
  }, "HYBRID"), null);
});
test("rejects duplicate, absent, unsupported, over-precision and invalid percentages", () => {
  const valid = { BTHWANI_CAPTAIN: "2", PARTNER_CAPTAIN: "5", CUSTOMER_PICKUP: "0" };
  assert.equal(storeCommercialRatesForProposal([], valid, "COMMISSION"), null);
  assert.equal(storeCommercialRatesForProposal(["BTHWANI_CAPTAIN", "BTHWANI_CAPTAIN"], valid, "COMMISSION"), null);
  assert.equal(storeCommercialRatesForProposal(["OTHER"], valid, "COMMISSION"), null);
  assert.equal(storeCommercialRatesForProposal(["PARTNER_CAPTAIN"], {}, "COMMISSION"), null);
  for (const bad of ["", "-0.01", "100.01", "NaN", "Infinity", "1.999", "1e309", "1e2", "0x10", " 1"]) {
    assert.equal(storeCommercialRatesForProposal(["BTHWANI_CAPTAIN"], { BTHWANI_CAPTAIN: bad }, "COMMISSION"), null, bad);
  }
});


test("canonical agreement readback requires all exact per-mode terms", () => {
  const expected = [
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 1200 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0 },
  ];
  assert.equal(sameStoreCommercialRates([...expected].reverse(), expected), true);
  assert.equal(sameStoreCommercialRates([expected[0], expected[0]], expected), false);
  assert.equal(sameStoreCommercialRates([expected[0]], expected), false);
  assert.equal(sameStoreCommercialRates([expected[0], { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 1 }], expected), false);
  assert.equal(sameStoreCommercialRates([expected[0], { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 }], expected), false);
});

test("subscription proposal is confirmed only when every financial and consent term matches", () => {
  const expected = {
    storeId: "store-1", proposedByActorId: "operator-1", agreementVersion: 2,
    reason: "New subscription negotiated with the store",
    commercialModel: "SUBSCRIPTION", recurringAmountMinor: 1500,
    billingPeriod: "MONTHLY", billingTimeZone: "Asia/Aden",
    invoiceDueDays: 7, graceDays: 3, renewalPolicy: "MANUAL",
    terminationTerms: "Cancel before the next renewal",
    adjustmentTerms: "Finance reviews partial refunds",
    rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 }],
  };
  const actual = { agreementId: "agreement-2", status: "PROPOSED", ...expected };
  assert.equal(matchesProposedStoreAgreement(actual, expected), true);
  const alterations = {
    agreementId: "", status: "PARTNER_ACCEPTED", storeId: "another-store",
    proposedByActorId: "another-operator", agreementVersion: 1,
    reason: "Changed terms", commercialModel: "HYBRID",
    recurringAmountMinor: 1600, billingPeriod: "ANNUAL", billingTimeZone: "UTC",
    invoiceDueDays: 8, graceDays: 4, renewalPolicy: "AUTOMATIC",
    terminationTerms: "Different cancellation policy", adjustmentTerms: "Different refund policy",
    rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 100 }],
  };
  for (const [field, replacement] of Object.entries(alterations)) {
    assert.equal(matchesProposedStoreAgreement({ ...actual, [field]: replacement }, expected), false, field);
  }
});

test("commission proposal also verifies canonical zero recurring terms", () => {
  const expected = {
    storeId: "store-2", proposedByActorId: "operator-2", agreementVersion: 1,
    reason: "Commission agreement for the new store",
    commercialModel: "COMMISSION", recurringAmountMinor: 0,
    billingPeriod: "NONE", billingTimeZone: "Asia/Aden",
    invoiceDueDays: 0, graceDays: 0, renewalPolicy: "NONE",
    terminationTerms: "", adjustmentTerms: "",
    rates: [{ fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 750 }],
  };
  const actual = { agreementId: "agreement-3", status: "PROPOSED", ...expected };
  assert.equal(matchesProposedStoreAgreement(actual, expected), true);
  assert.equal(matchesProposedStoreAgreement({ ...actual, recurringAmountMinor: 1 }, expected), false);
  assert.equal(matchesProposedStoreAgreement({ ...actual, billingPeriod: "MONTHLY" }, expected), false);
  assert.equal(matchesProposedStoreAgreement({ ...actual, rates: [{ ...expected.rates[0], commissionRateBps: 751 }] }, expected), false);
});
