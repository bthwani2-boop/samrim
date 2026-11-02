import assert from "node:assert/strict";
import { test } from "node:test";
import { canManagePolicy } from "../src/features/policies/policy-capabilities.ts";
import { storeCommercialStatusLabel } from "../src/features/finance/store-commercial-agreement-types.ts";

test("store commercial model policy requires the three independent operator permissions", () => {
  const key = "store-commercial-model";
  assert.equal(canManagePolicy(key, []), false);
  assert.equal(canManagePolicy(key, ["partners"]), false);
  assert.equal(canManagePolicy(key, ["partners", "finance"]), false);
  assert.equal(canManagePolicy(key, ["partners", "platform_policies"]), false);
  assert.equal(canManagePolicy(key, ["finance", "platform_policies"]), false);
  assert.equal(canManagePolicy(key, ["partners", "finance", "platform_policies"]), true);
  assert.equal(canManagePolicy("store-type-commission-defaults", ["finance", "platform_policies"]), true);
});

test("finance labels are model-aware, without activating the subscription or retired hybrid", () => {
  assert.equal(storeCommercialStatusLabel({ status: "PARTNER_ACCEPTED", commercialModel: "COMMISSION" }), "بانتظار قرار المالية");
  assert.match(storeCommercialStatusLabel({ status: "PARTNER_ACCEPTED", commercialModel: "SUBSCRIPTION" }), /الاشتراك|اشتراك/);
  assert.match(storeCommercialStatusLabel({ status: "PARTNER_ACCEPTED", commercialModel: "SUBSCRIPTION" }), /غير قابل للاعتماد/);
  assert.match(storeCommercialStatusLabel({ status: "PARTNER_ACCEPTED", commercialModel: "HYBRID" }), /ملغى/);
  assert.equal(storeCommercialStatusLabel({ status: "PROPOSED", commercialModel: "SUBSCRIPTION" }), "بانتظار قبول مالك المتجر");
  assert.equal(storeCommercialStatusLabel({ status: "ACTIVE", commercialModel: "COMMISSION" }), "نشط");
});
