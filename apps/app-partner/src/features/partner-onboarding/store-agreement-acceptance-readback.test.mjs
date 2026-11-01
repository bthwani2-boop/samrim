import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasReviewableStoreAgreementRates,
  isConfirmedOwnStoreAgreementAcceptance,
} from "./store-agreement-acceptance-readback.ts";

const reviewedAgreement = {
  storeId: "store-owned",
  partnerActorId: "partner-owner",
  agreementId: "agreement-1",
  agreementVersion: 3,
  status: "PROPOSED",
  commercialModel: "SUBSCRIPTION",
  recurringAmountMinor: 2500,
  billingPeriod: "MONTHLY",
  billingTimeZone: "Asia/Aden",
  invoiceDueDays: 7,
  graceDays: 3,
  renewalPolicy: "MANUAL",
  terminationTerms: "Cancel before renewal",
  adjustmentTerms: "Finance reviews refunds",
  rates: [
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0, deliveryMarkupMinor: 100 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FIXED", deliveryFixedFeeMinor: 600 },
  ],
};
const expected = {
  storeID: "store-owned",
  actorID: "partner-owner",
  agreementID: "agreement-1",
  expectedVersion: 3,
  reviewedAgreement,
};

test("partner cannot review or accept an agreement with no commission rates", () => {
  assert.equal(hasReviewableStoreAgreementRates({ commercialModel: "COMMISSION", rates: [] }), false);
  assert.equal(hasReviewableStoreAgreementRates({
    commercialModel: "COMMISSION", rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 }],
  }), true);
});

test("partner refuses duplicate, altered, or unapproved Store rate rules before accepting", () => {
  assert.equal(hasReviewableStoreAgreementRates(reviewedAgreement), true);
  const [captain, partner] = reviewedAgreement.rates;
  const invalid = [
    [captain, captain],
    [{ ...captain, fulfillmentMode: "UNKNOWN" }],
    [{ ...captain, commissionRateBps: 1 }],
    [{ ...captain, deliveryMarkupMinor: -1 }],
    [{ ...captain, deliveryMarkupMinor: 10001 }],
    [{ ...captain, deliveryPricingMode: "FREE" }],
    [{ ...captain, deliveryFixedFeeMinor: 1 }],
    [{ ...partner, deliveryMarkupMinor: 100 }],
    [{ ...partner, deliveryPricingMode: "FREE", deliveryFixedFeeMinor: 600 }],
    [{ ...partner, deliveryFixedFeeMinor: 20001 }],
    [{ ...partner, commissionRateBps: 10001 }],
    [{ ...partner, commissionRateBps: "0" }],
  ];
  for (const rates of invalid) assert.equal(hasReviewableStoreAgreementRates({ ...reviewedAgreement, rates }), false, JSON.stringify(rates));
  assert.equal(hasReviewableStoreAgreementRates({ ...reviewedAgreement, commercialModel: "COMMISSION" }), true);
  assert.equal(hasReviewableStoreAgreementRates({ ...reviewedAgreement, commercialModel: "HYBRID" }), true);
});

test("partner acceptance readback must belong to the accepting owner and exact reviewed terms", () => {
  const accepted = {
    ...reviewedAgreement,
    status: "PARTNER_ACCEPTED",
    partnerAcceptedByActorId: expected.actorID,
    partnerAcceptedAt: "2026-10-20T00:00:00Z",
  };
  assert.equal(isConfirmedOwnStoreAgreementAcceptance(accepted, expected), true);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, status: "ACTIVE" }, expected), true);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({
    ...accepted, rates: [...accepted.rates].reverse(),
  }, expected), true);
  const altered = {
    storeId: "other-store",
    partnerActorId: "other-owner",
    agreementId: "other-agreement",
    agreementVersion: 4,
    status: "PROPOSED",
    partnerAcceptedByActorId: "other-owner",
    partnerAcceptedAt: null,
    commercialModel: "HYBRID",
    recurringAmountMinor: 2600,
    billingPeriod: "ANNUAL",
    billingTimeZone: "UTC",
    invoiceDueDays: 8,
    graceDays: 4,
    renewalPolicy: "AUTOMATIC",
    terminationTerms: "Different cancellation",
    adjustmentTerms: "Different refunds",
    rates: [
      { ...accepted.rates[0], deliveryMarkupMinor: 200 },
      accepted.rates[1],
    ],
  };
  for (const [field, replacement] of Object.entries(altered)) {
    assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, [field]: replacement }, expected), false, field);
  }
  const changedRate = [...accepted.rates];
  changedRate[0] = { ...changedRate[0], commissionRateBps: 10 };
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, rates: changedRate }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({
    ...accepted, rates: [accepted.rates[0], accepted.rates[0]],
  }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({
    ...accepted, rates: [accepted.rates[0], { ...accepted.rates[1], deliveryPricingMode: "FREE" }],
  }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({
    ...accepted, rates: [accepted.rates[0], { ...accepted.rates[1], deliveryFixedFeeMinor: 601 }],
  }, expected), false);
});
