import assert from "node:assert/strict";
import { test } from "node:test";

import { storeInvitationReadbackConfirmed } from "../../apps/app-partner/src/features/partner-onboarding/store-access-invite-readback.ts";

const created = {
  id: "grant-1",
  storeId: "store-1",
  ownerPartnerActorId: "partner-owner",
  delegateActorId: "delegate-1",
  permissions: ["orders", "fulfillment"],
  state: "pending_acceptance",
  version: 1,
};

test("invite is confirmed only by the exact owner-scoped persisted DSH grant", () => {
  assert.equal(storeInvitationReadbackConfirmed("store-1", created, ["fulfillment", "orders"], { ...created }), true);
  assert.equal(storeInvitationReadbackConfirmed("store-1", created, created.permissions, { ...created, state: "active", version: 2 }), true);
  assert.equal(storeInvitationReadbackConfirmed("store-1", created, created.permissions, undefined), false);
});

test("another store, owner, actor, id, or incomplete permissions never confirms", () => {
  const changes = [
    { id: "grant-2" },
    { storeId: "store-2" },
    { ownerPartnerActorId: "other-owner" },
    { delegateActorId: "other-actor" },
    { permissions: ["orders"] },
    { version: 0 },
  ];
  for (const change of changes) {
    assert.equal(storeInvitationReadbackConfirmed("store-1", created, created.permissions, { ...created, ...change }), false, JSON.stringify(change));
  }
  assert.equal(storeInvitationReadbackConfirmed("store-2", created, created.permissions, created), false);
  assert.equal(storeInvitationReadbackConfirmed("store-1", created, ["orders"], created), false);
  assert.equal(storeInvitationReadbackConfirmed("store-1", created, [], created), false);
});

test("a declined, revoked, suspended, or expired grant is not an active invitation", () => {
  for (const state of ["declined", "revoked", "suspended", "expired"]) {
    assert.equal(storeInvitationReadbackConfirmed("store-1", created, created.permissions, { ...created, state, version: 2 }), false, state);
  }
});

test("the mutation receipt is not itself sufficient when it differs from the requested permissions", () => {
  assert.equal(storeInvitationReadbackConfirmed("store-1", { ...created, permissions: ["orders"] }, ["orders", "fulfillment"], created), false);
  assert.equal(storeInvitationReadbackConfirmed("store-1", { ...created, ownerPartnerActorId: "" }, created.permissions, created), false);
  assert.equal(storeInvitationReadbackConfirmed("store-1", { ...created, delegateActorId: "" }, created.permissions, created), false);
});
