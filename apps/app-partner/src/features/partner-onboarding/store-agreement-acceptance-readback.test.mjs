import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasReviewableStoreAgreementRates,
  isConfirmedOwnStoreAgreementAcceptance,
} from "./store-agreement-acceptance-readback.ts";

const expected = {
  storeID: "store-owned",
  actorID: "partner-owner",
  agreementID: "agreement-1",
  expectedVersion: 3,
};

test("partner cannot review or accept an agreement with no commission rates", () => {
  assert.equal(hasReviewableStoreAgreementRates({ rates: [] }), false);
  assert.equal(hasReviewableStoreAgreementRates({
    rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 }],
  }), true);
});

test("partner acceptance readback must belong to the accepting owner and proposal", () => {
  const accepted = {
    storeId: expected.storeID,
    partnerActorId: expected.actorID,
    agreementId: expected.agreementID,
    agreementVersion: expected.expectedVersion,
    status: "PARTNER_ACCEPTED",
    partnerAcceptedByActorId: expected.actorID,
    partnerAcceptedAt: "2026-10-20T00:00:00Z",
  };
  assert.equal(isConfirmedOwnStoreAgreementAcceptance(accepted, expected), true);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, storeId: "other-store" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, partnerAcceptedByActorId: "other-owner" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, status: "PROPOSED" }, expected), false);
});
