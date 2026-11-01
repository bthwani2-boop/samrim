import assert from "node:assert/strict";
import test from "node:test";
import { preferredCaptainProfileMembership, visibleCaptainStoreMemberships } from "./captain-store-membership-policy.ts";

test("captain displays pending memberships without treating them as active", () => {
  const pending = { id: "pending", state: "pending", displayNameAr: "كابتن متقدم" };
  const active = { id: "active", state: "active", displayNameAr: "كابتن معتمد" };
  const revoked = { id: "revoked", state: "revoked", displayNameAr: "كابتن سابق" };
  assert.deepEqual(visibleCaptainStoreMemberships([pending, active, revoked]), [pending, active]);
  assert.equal(preferredCaptainProfileMembership([pending, active, revoked]), active);
  assert.equal(preferredCaptainProfileMembership([pending, revoked]), pending);
  assert.equal(preferredCaptainProfileMembership([revoked]), undefined);
});

test("an unnamed pending membership cannot produce a misleading profile", () => {
  assert.equal(preferredCaptainProfileMembership([
    { id: "empty", state: "pending", displayNameAr: " " },
  ]), undefined);
});
