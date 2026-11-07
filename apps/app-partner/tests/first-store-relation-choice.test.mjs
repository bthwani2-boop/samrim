import assert from "node:assert/strict";
import { test } from "node:test";
import { firstStoreModesForRelation, firstStoreRelationCanEnroll } from "../src/features/partner-onboarding/first-store-relation-choice.ts";

test("first Store enrollment only shows an explicitly enabled DSH relation", () => {
  const policies = [
    { relationModel: "BTHWANI_PARTNER", enrollmentEnabled: true },
    { relationModel: "INDEPENDENT_STORE", enrollmentEnabled: false },
  ];
  assert.equal(firstStoreRelationCanEnroll(policies, "BTHWANI_PARTNER"), true);
  assert.equal(firstStoreRelationCanEnroll(policies, "INDEPENDENT_STORE"), false);
  assert.equal(firstStoreRelationCanEnroll(policies, ""), false);
  assert.equal(firstStoreRelationCanEnroll([], "BTHWANI_PARTNER"), false);
  assert.equal(firstStoreRelationCanEnroll([{ relationModel: "INDEPENDENT_STORE", enrollmentEnabled: true }], "BTHWANI_PARTNER"), false);
});

test("switching relationship removes platform delivery from independent Store selection", () => {
  assert.deepEqual(firstStoreModesForRelation("BTHWANI_PARTNER", "INDEPENDENT_STORE", ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN"]), ["CUSTOMER_PICKUP"]);
  assert.deepEqual(firstStoreModesForRelation("INDEPENDENT_STORE", "INDEPENDENT_STORE", ["PARTNER_CAPTAIN"]), ["PARTNER_CAPTAIN"]);
  assert.deepEqual(firstStoreModesForRelation("INDEPENDENT_STORE", "BTHWANI_PARTNER", ["CUSTOMER_PICKUP"]), ["BTHWANI_CAPTAIN"]);
});
