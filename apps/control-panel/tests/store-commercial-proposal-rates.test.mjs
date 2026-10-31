import assert from "node:assert/strict";
import { test } from "node:test";
import { sameStoreCommercialRates, storeCommercialRatesForProposal } from "../src/features/partner-onboarding/store-commercial-proposal-rates.ts";

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
test("hybrid requires some positive commission but allows zero on another mode", () => {
  assert.deepEqual(storeCommercialRatesForProposal(modes, {
    BTHWANI_CAPTAIN: "0", PARTNER_CAPTAIN: "1", CUSTOMER_PICKUP: "0",
  }, "HYBRID"), [
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 100 },
    { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 },
  ]);
  assert.equal(storeCommercialRatesForProposal(modes, {
    BTHWANI_CAPTAIN: "0", PARTNER_CAPTAIN: "0", CUSTOMER_PICKUP: "0",
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
