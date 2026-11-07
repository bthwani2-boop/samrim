import assert from "node:assert/strict";
import { test } from "node:test";
import { validStoreJoiningPolicyReadback } from "../src/features/policies/store-joining-policy-readback.ts";

const policy = (relationModel, enrollmentEnabled = true, version = 1) => ({
  relationModel, enrollmentEnabled, version, updatedAt: "", updatedBy: "", reason: "",
});
const partner = policy("BTHWANI_PARTNER");
const independent = policy("INDEPENDENT_STORE", false);

test("operator enrollment policy readback requires both distinct canonical DSH models", () => {
  assert.equal(validStoreJoiningPolicyReadback([partner, independent]), true);
  assert.equal(validStoreJoiningPolicyReadback([independent, partner]), true);
  assert.equal(validStoreJoiningPolicyReadback([]), false);
  assert.equal(validStoreJoiningPolicyReadback([partner]), false);
  assert.equal(validStoreJoiningPolicyReadback([partner, partner]), false);
  assert.equal(validStoreJoiningPolicyReadback([partner, policy("OTHER")]), false);
});

test("policy UI rejects malformed or unversioned readback instead of allowing a write", () => {
  assert.equal(validStoreJoiningPolicyReadback(null), false);
  assert.equal(validStoreJoiningPolicyReadback([partner, { ...independent, enrollmentEnabled: "true" }]), false);
  assert.equal(validStoreJoiningPolicyReadback([partner, policy("INDEPENDENT_STORE", false, 0)]), false);
  assert.equal(validStoreJoiningPolicyReadback([partner, policy("INDEPENDENT_STORE", false, 1.5)]), false);
});
