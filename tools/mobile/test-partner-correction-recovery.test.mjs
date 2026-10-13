import assert from "node:assert/strict";
import { test } from "node:test";

import {
  partnerCorrectionIdentityPayload,
  partnerCorrectionPublicReadbackMatches,
} from "../../apps/app-partner/src/features/partner-onboarding/partner-correction-recovery.ts";

const input = {
  ownerFullName: "مالك المتجر",
  businessName: "النشاط",
  firstStoreName: "المتجر",
  firstStoreAddress: "صنعاء شارع",
  serviceCityId: "city-sanaa",
  firstStoreVerticalId: "restaurant",
  firstStoreCommercialTypeId: "restaurant-fast",
  firstStoreLatitude: 15.36,
  firstStoreLongitude: 44.19,
  firstStoreWorkingHours: { intervals: [
    { dayOfWeek: 2, opensAt: "09:00", closesAt: "17:00", closesNextDay: false },
    { dayOfWeek: 1, opensAt: "10:00", closesAt: "18:00", closesNextDay: false },
  ] },
  firstStoreProofType: "FREELANCE_WORK_DOCUMENT",
  firstStoreProofNumber: "12345",
  firstStoreNotes: "ملاحظة",
  firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"],
};

const readback = {
  ...input,
  id: "case-1",
  state: "submitted",
  firstStoreProofNumberPresent: true,
  firstStoreProofNumber: undefined,
};

test("same partner correction and same version use an identical replay identity despite set ordering", () => {
  const original = partnerCorrectionIdentityPayload("case-1", 2, input);
  const permuted = { ...input, firstStoreWorkingHours: { intervals: [...input.firstStoreWorkingHours.intervals].reverse() }, firstStoreFulfillmentModes: [...input.firstStoreFulfillmentModes].reverse() };
  assert.equal(partnerCorrectionIdentityPayload("case-1", 2, permuted), original);
  assert.notEqual(partnerCorrectionIdentityPayload("case-1", 3, input), original);
  assert.notEqual(partnerCorrectionIdentityPayload("case-2", 2, input), original);
  assert.notEqual(partnerCorrectionIdentityPayload("case-1", 2, { ...input, firstStoreNotes: "changed" }), original);
  assert.notEqual(partnerCorrectionIdentityPayload("case-1", 2, { ...input, firstStoreProofNumber: "54321" }), original);
});

test("canonical partner correction recovery requires the exact case, submitted state and matching public facts", () => {
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, readback), true);
  assert.equal(partnerCorrectionPublicReadbackMatches("case-2", input, readback), false);
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, { ...readback, state: "needs_correction" }), false);
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, { ...readback, state: "approved" }), false);
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, { ...readback, serviceCityId: "other-city" }), false);
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, { ...readback, firstStoreProofNumberPresent: false }), false);
});

test("public fact order is irrelevant, but changes to hours or fulfillment are not confirmed", () => {
  const reordered = { ...readback, firstStoreWorkingHours: { intervals: [...readback.firstStoreWorkingHours.intervals].reverse() }, firstStoreFulfillmentModes: [...readback.firstStoreFulfillmentModes].reverse() };
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, reordered), true);
  const differentHours = { ...readback, firstStoreWorkingHours: { intervals: [{ ...input.firstStoreWorkingHours.intervals[0], opensAt: "08:00" }] } };
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, differentHours), false);
  assert.equal(partnerCorrectionPublicReadbackMatches("case-1", input, { ...readback, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] }), false);
});
