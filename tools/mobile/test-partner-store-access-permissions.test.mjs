import assert from "node:assert/strict";
import { test } from "node:test";

import { toggleStoreAccessPermission } from "../../apps/app-partner/src/features/partner-onboarding/store-access-permission-toggle.ts";

test("fulfillment always carries orders and dropping orders also drops fulfillment", () => {
  assert.deepEqual(toggleStoreAccessPermission(["orders"], "fulfillment"), ["orders", "fulfillment"]);
  assert.deepEqual(toggleStoreAccessPermission(["orders", "fulfillment"], "orders"), []);
  assert.deepEqual(toggleStoreAccessPermission(["orders", "fulfillment"], "fulfillment"), ["orders"]);
});

test("adding an unrelated permission never silently grants finance or payout rights", () => {
  assert.deepEqual(toggleStoreAccessPermission(["catalog"], "store_operations"), ["catalog", "store_operations"]);
  assert.deepEqual(toggleStoreAccessPermission(["catalog"], "payout_request"), ["catalog", "payout_request"]);
  assert.deepEqual(toggleStoreAccessPermission(["orders"], "finance_read"), ["orders", "finance_read"]);
});

test("invitation/grant toggles are stable and cannot duplicate entitlements", () => {
  const added = toggleStoreAccessPermission(["fulfillment", "orders"], "catalog");
  assert.deepEqual(added, ["fulfillment", "orders", "catalog"]);
  const removed = toggleStoreAccessPermission(added, "catalog");
  assert.deepEqual(removed, ["fulfillment", "orders"]);
  assert.deepEqual(toggleStoreAccessPermission(["orders", "fulfillment", "catalog"], "orders"), ["catalog"]);
});
