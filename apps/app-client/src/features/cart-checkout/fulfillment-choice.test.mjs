import assert from "node:assert/strict";
import test from "node:test";
import { resolveFulfillmentChoice } from "./fulfillment-choice-core.ts";

const all = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];

test("a store with exactly one valid fulfillment mode requires no selection", () => {
  assert.equal(resolveFulfillmentChoice(["PARTNER_CAPTAIN"], null, null), "PARTNER_CAPTAIN");
  assert.equal(resolveFulfillmentChoice(["CUSTOMER_PICKUP"], "BTHWANI_CAPTAIN", "BTHWANI_CAPTAIN"), "CUSTOMER_PICKUP");
});
test("explicit user choice takes precedence over saved preference", () => {
  assert.equal(resolveFulfillmentChoice(all, "PARTNER_CAPTAIN", "BTHWANI_CAPTAIN"), "PARTNER_CAPTAIN");
});
test("a valid saved choice follows the customer between store and checkout", () => {
  assert.equal(resolveFulfillmentChoice(all, null, "PARTNER_CAPTAIN"), "PARTNER_CAPTAIN");
});
test("never silently turn an unavailable choice into a different delivery mode", () => {
  assert.equal(resolveFulfillmentChoice(["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"], null, "PARTNER_CAPTAIN"), null);
  assert.equal(resolveFulfillmentChoice(all, "INVALID", null), null);
});
test("unsupported stores have no fulfillment choice", () => {
  assert.equal(resolveFulfillmentChoice([], "PARTNER_CAPTAIN", "PARTNER_CAPTAIN"), null);
});
