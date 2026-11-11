import assert from "node:assert/strict";
import { test } from "node:test";
import { firstStoreFulfillmentLabel, firstStoreModesForRelation, firstStoreRelationCanEnroll } from "./first-store-relation-choice.ts";

test("returning to the relation step and tapping the same model preserves deliberate fulfillment", () => {
  const chosen = ["PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];
  assert.deepEqual(firstStoreModesForRelation("BTHWANI_PARTNER", "BTHWANI_PARTNER", chosen), chosen);
  assert.deepEqual(firstStoreModesForRelation("INDEPENDENT_STORE", "INDEPENDENT_STORE", ["PARTNER_CAPTAIN"]), ["PARTNER_CAPTAIN"]);
  assert.deepEqual(chosen, ["PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]);
});

test("changing to an independent Store drops BThwani Captain and selects the safe initial pickup mode", () => {
  assert.deepEqual(firstStoreModesForRelation("BTHWANI_PARTNER", "INDEPENDENT_STORE", ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN"]), ["CUSTOMER_PICKUP"]);
  assert.deepEqual(firstStoreModesForRelation("", "INDEPENDENT_STORE", ["BTHWANI_CAPTAIN"]), ["CUSTOMER_PICKUP"]);
  assert.deepEqual(firstStoreModesForRelation("INDEPENDENT_STORE", "BTHWANI_PARTNER", ["PARTNER_CAPTAIN"]), ["BTHWANI_CAPTAIN"]);
  assert.deepEqual(firstStoreModesForRelation("INDEPENDENT_STORE", "BTHWANI_PARTNER", ["CUSTOMER_PICKUP"]), ["BTHWANI_CAPTAIN"]);
});

test("review labels reflect each exact fulfillment choice, without invented availability", () => {
  assert.equal(firstStoreFulfillmentLabel("BTHWANI_CAPTAIN"), "توصيل بثواني");
  assert.equal(firstStoreFulfillmentLabel("PARTNER_CAPTAIN"), "مندوب المتجر");
  assert.equal(firstStoreFulfillmentLabel("CUSTOMER_PICKUP"), "استلام من المتجر");
});

test("returning to independent enrollment drops a stale marketplace Captain even for the same relation", () => {
  assert.deepEqual(
    firstStoreModesForRelation("INDEPENDENT_STORE", "INDEPENDENT_STORE", ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]),
    ["PARTNER_CAPTAIN", "CUSTOMER_PICKUP"],
  );
  assert.deepEqual(firstStoreModesForRelation("INDEPENDENT_STORE", "INDEPENDENT_STORE", ["BTHWANI_CAPTAIN"]), []);
});

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

test("unrecognized relation and mode cannot silently enable marketplace delivery", () => {
  assert.deepEqual(firstStoreModesForRelation("", "UNRECOGNIZED_RELATION", ["BTHWANI_CAPTAIN"]), []);
  assert.deepEqual(firstStoreModesForRelation("BTHWANI_PARTNER", "BTHWANI_PARTNER", ["UNKNOWN_MODE", "CUSTOMER_PICKUP"]), ["CUSTOMER_PICKUP"]);
  assert.equal(firstStoreRelationCanEnroll([{ relationModel: "UNKNOWN_MODEL", enrollmentEnabled: true }], "UNKNOWN_MODEL"), false);
  assert.equal(firstStoreRelationCanEnroll([{ relationModel: "INDEPENDENT_STORE", enrollmentEnabled: "true" }], "INDEPENDENT_STORE"), false);
});
