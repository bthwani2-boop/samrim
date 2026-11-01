import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerRepeatBuyerPercentage } from "../src/features/partner-onboarding/partner-customer-activity.ts";

const base = {
  storeId: "store-A", period: "30d", measuredAt: "2026-11-01T10:00:00+03:00",
  totalOrders: 12, deliveredOrders: 8, pickedUpOrders: 2,
  completedCustomers: 5, returningCustomers: 2,
};

test("repeat-buyer share counts distinct completed customers, not orders", () => {
  assert.equal(partnerRepeatBuyerPercentage(base), 40);
  assert.equal(partnerRepeatBuyerPercentage({ ...base, returningCustomers: 1 }), 20);
  assert.equal(partnerRepeatBuyerPercentage({ ...base, completedCustomers: 3, returningCustomers: 1 }), 33.3);
});

test("empty, malformed, inconsistent and unavailable summaries show no percentage", () => {
  assert.equal(partnerRepeatBuyerPercentage({ ...base, completedCustomers: 0, returningCustomers: 0 }), null);
  assert.equal(partnerRepeatBuyerPercentage({ ...base, returningCustomers: 6 }), null);
  assert.equal(partnerRepeatBuyerPercentage({ ...base, completedCustomers: Number.NaN }), null);
  assert.equal(partnerRepeatBuyerPercentage({ ...base, measuredAt: "invalid" }), null);
  assert.equal(partnerRepeatBuyerPercentage(null), null);
});
