import assert from "node:assert/strict";
import { test } from "node:test";

import {
  invitationActionConfirmed,
  invitationActionIdentity,
} from "../../apps/app-partner/src/features/partner-onboarding/store-access-invitation-recovery.ts";

const original = { id: "grant-1", storeId: "store-a", delegateActorId: "actor-1", version: 2 };
const current = {
  ...original,
  version: 3,
  state: "pending_partner_activation",
  acceptedAt: "2026-10-13T12:00:00Z",
};

test("same action, grant and version reuse one mutation identity", () => {
  const first = invitationActionIdentity("grant-1", 2, "accept");
  assert.equal(first, invitationActionIdentity("grant-1", 2, "accept"));
  assert.notEqual(first, invitationActionIdentity("grant-1", 2, "decline"));
  assert.notEqual(first, invitationActionIdentity("grant-1", 3, "accept"));
  assert.notEqual(first, invitationActionIdentity("grant-2", 2, "accept"));
  assert.notEqual(first, invitationActionIdentity("grant-1", 2, "activate"));
});

test("accept success derives only from canonical DSH accepted states", () => {
  assert.equal(invitationActionConfirmed(original, current, "accept"), true);
  assert.equal(invitationActionConfirmed(original, { ...current, state: "pending_role_admission" }, "accept"), true);
  assert.equal(invitationActionConfirmed(original, { ...current, state: "active" }, "accept"), true);
  for (const state of ["pending_acceptance", "declined", "revoked", "suspended", "expired"]) {
    assert.equal(invitationActionConfirmed(original, { ...current, state }, "accept"), false, state);
  }
  assert.equal(invitationActionConfirmed(original, { ...current, acceptedAt: null }, "accept"), false);
});

test("decline and activation require own persisted terminal state and proof", () => {
  assert.equal(invitationActionConfirmed(original, { ...current, state: "declined", declinedAt: "2026-10-13T12:00:00Z" }, "decline"), true);
  assert.equal(invitationActionConfirmed(original, { ...current, state: "declined" }, "decline"), false);
  assert.equal(invitationActionConfirmed(original, { ...current, state: "active" }, "activate"), true);
  assert.equal(invitationActionConfirmed(original, current, "activate"), false);
});

test("wrong store, actor, grant, version or missing readback never confirms", () => {
  assert.equal(invitationActionConfirmed(original, undefined, "accept"), false);
  assert.equal(invitationActionConfirmed(original, { ...current, id: "grant-2" }, "accept"), false);
  assert.equal(invitationActionConfirmed(original, { ...current, storeId: "store-b" }, "accept"), false);
  assert.equal(invitationActionConfirmed(original, { ...current, delegateActorId: "actor-2" }, "accept"), false);
  assert.equal(invitationActionConfirmed(original, { ...current, version: 2 }, "accept"), false);
  assert.equal(invitationActionConfirmed(original, { ...current, version: 1 }, "accept"), false);
});
