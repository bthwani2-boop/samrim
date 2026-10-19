import assert from "node:assert/strict";
import { test } from "node:test";

import { storeInvitationReadbackConfirmed } from "./store-access-invite-readback.ts";
import {
  storeAccessPermissionsMutationIdentity,
  storeAccessPermissionsReadbackConfirmed,
} from "./store-access-permission-toggle.ts";

const previous = {
  id: "grant-1",
  storeId: "store-1",
  ownerPartnerActorId: "owner-1",
  delegateActorId: "delegate-1",
  version: 2,
};

test("store delegation retry identity is stable across permission order, not scope", () => {
  const identity = storeAccessPermissionsMutationIdentity(
    previous.storeId, previous.id, previous.version, ["orders", "fulfillment"],
  );
  assert.equal(
    identity,
    storeAccessPermissionsMutationIdentity(
      previous.storeId, previous.id, previous.version, ["fulfillment", "orders"],
    ),
  );
  assert.notEqual(identity, storeAccessPermissionsMutationIdentity("store-2", previous.id, previous.version, ["orders", "fulfillment"]));
  assert.notEqual(identity, storeAccessPermissionsMutationIdentity(previous.storeId, previous.id, previous.version + 1, ["orders", "fulfillment"]));
});

test("DSH canonical delegation readback requires version, actor and permission integrity", () => {
  const canonical = { ...previous, version: 3, permissions: ["fulfillment", "orders"], state: "active" };
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, canonical, ["orders", "fulfillment"]), true);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, version: 2 }, ["orders", "fulfillment"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, { ...canonical, delegateActorId: "different" }, ["orders", "fulfillment"]), false);
  assert.equal(storeAccessPermissionsReadbackConfirmed(previous, canonical, ["orders"]), false);
});

test("store invitation readback cannot confirm a mismatched store or missing permission", () => {
  const submitted = { ...previous, permissions: ["orders", "fulfillment"] };
  const canonical = { ...submitted, version: 3, permissions: ["fulfillment", "orders"], state: "active" };
  assert.equal(storeInvitationReadbackConfirmed(previous.storeId, submitted, ["orders", "fulfillment"], canonical), true);
  assert.equal(storeInvitationReadbackConfirmed("other-store", submitted, ["orders", "fulfillment"], canonical), false);
  assert.equal(storeInvitationReadbackConfirmed(previous.storeId, submitted, ["orders", "fulfillment"], { ...canonical, permissions: ["orders"] }), false);
});
