import assert from "node:assert/strict";
import { test } from "node:test";

import { storeAccessPermissionsMutationIdentity, storeAccessPermissionsReadbackConfirmed, toggleStoreAccessPermission } from "../../apps/app-partner/src/features/partner-onboarding/store-access-permission-toggle.ts";

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

test("grant permission retry identity is stable for the same facts/version and distinct for changes", () => {
  const saved = storeAccessPermissionsMutationIdentity("s1", "g1", 5, ["orders", "catalog"]);
  assert.equal(saved, storeAccessPermissionsMutationIdentity("s1", "g1", 5, ["catalog", "orders"]));
  assert.notEqual(saved, storeAccessPermissionsMutationIdentity("s2", "g1", 5, ["orders", "catalog"]));
  assert.notEqual(saved, storeAccessPermissionsMutationIdentity("s1", "g2", 5, ["orders", "catalog"]));
  assert.notEqual(saved, storeAccessPermissionsMutationIdentity("s1", "g1", 6, ["orders", "catalog"]));
  assert.notEqual(saved, storeAccessPermissionsMutationIdentity("s1", "g1", 5, ["finance_read", "catalog"]));
});

test("DSH owner permission readback checks grant, tenant, actor, version and exact rights", () => {
  const previous = { id: "g1", storeId: "s1", ownerPartnerActorId: "owner1", delegateActorId: "staff1", version: 5 };
  const canonical = { ...previous, version: 6, state: "active", permissions: ["catalog", "orders"] };
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, canonical, ["orders", "catalog"]), true);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, undefined, ["orders", "catalog"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, storeId: "s2" }, ["orders", "catalog"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, ownerPartnerActorId: "owner2" }, ["orders", "catalog"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, delegateActorId: "staff2" }, ["orders", "catalog"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, version: 5 }, ["orders", "catalog"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, permissions: ["orders"] }, ["orders", "catalog"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, canonical, []), false);
});
