import assert from "node:assert/strict";
import { test } from "node:test";
import { verifiedPartnerCustomerActivity } from "../src/features/partner-onboarding/partner-customer-activity.ts";

const summary = {
  storeId: "owned-store", period: "30d", measuredAt: "2026-11-01T10:00:00+03:00",
  totalOrders: 8, deliveredOrders: 5, pickedUpOrders: 1,
  completedCustomers: 4, returningCustomers: 2,
};

test("partner sees only its Store's canonical completed-customer activity", () => {
  assert.equal(verifiedPartnerCustomerActivity(summary, "owned-store", "30d"), summary);
  assert.equal(verifiedPartnerCustomerActivity(summary, "other-store", "30d"), null);
  assert.equal(verifiedPartnerCustomerActivity(summary, "owned-store", "all"), null);
});

test("partner rejects malformed customer aggregates and cannot infer identities", () => {
  for (const changed of [
    { measuredAt: "invalid" }, { totalOrders: 0 }, { deliveredOrders: 99 },
    { pickedUpOrders: -1 }, { completedCustomers: 7 }, { returningCustomers: 5 },
    { returningCustomers: 1.5 }, { completedCustomers: Number.NaN },
  ]) {
    assert.equal(verifiedPartnerCustomerActivity({ ...summary, ...changed }, "owned-store", "30d"), null, JSON.stringify(changed));
  }
  assert.equal(verifiedPartnerCustomerActivity(null, "owned-store", "30d"), null);
});
