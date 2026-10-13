import assert from "node:assert/strict";
import { test } from "node:test";

import { isConfirmedOwnStoreAgreementAcceptance } from "../../apps/app-partner/src/features/partner-onboarding/store-agreement-acceptance-readback.ts";

const expected = { storeID: "store-1", actorID: "partner-1", agreementID: "agreement-1", expectedVersion: 4 };
const accepted = {
  storeId: "store-1",
  partnerActorId: "partner-1",
  agreementId: "agreement-1",
  agreementVersion: 4,
  status: "PARTNER_ACCEPTED",
  partnerAcceptedByActorId: "partner-1",
  partnerAcceptedAt: "2026-10-13T12:00:00Z",
  rates: [{ fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 1000 }],
};

test("acceptance proof permits owner-accepted and finance-active for the same agreement", () => {
  assert.equal(isConfirmedOwnStoreAgreementAcceptance(accepted, expected), true);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, status: "ACTIVE", agreementVersion: 5 }, expected), true);
});

test("another store, partner, acceptance actor, agreement or version never confirms", () => {
  assert.equal(isConfirmedOwnStoreAgreementAcceptance(undefined, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, storeId: "store-2" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, partnerActorId: "partner-2" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, partnerAcceptedByActorId: "partner-2" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, agreementId: "agreement-2" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, agreementVersion: 3 }, expected), false);
});

test("status and persisted acceptance timestamp are both required", () => {
  for (const status of ["PROPOSED", "FINANCE_REJECTED", "REJECTED", "SUPERSEDED"]) {
    assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, status }, expected), false, status);
  }
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, partnerAcceptedAt: null }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, partnerAcceptedAt: "" }, expected), false);
  assert.equal(isConfirmedOwnStoreAgreementAcceptance({ ...accepted, partnerAcceptedByActorId: null }, expected), false);
});
