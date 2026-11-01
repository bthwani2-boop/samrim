import assert from "node:assert/strict";
import { test } from "node:test";

import { hasExactCommissionSuggestionReadback } from "../src/features/finance/store-type-commission-default-readback.ts";

const expected = {
  commercialStoreTypeId: "grocery",
  fulfillmentMode: "BTHWANI_CAPTAIN",
  suggestedCommissionRateBps: 700,
  defaultVersion: 2,
};

test("suggestion save requires exact canonical Store Type, mode, rate and version", () => {
  assert.equal(hasExactCommissionSuggestionReadback([expected], expected), true);
  for (const differing of [
    { ...expected, commercialStoreTypeId: "pharmacy" },
    { ...expected, fulfillmentMode: "CUSTOMER_PICKUP" },
    { ...expected, suggestedCommissionRateBps: 701 },
    { ...expected, defaultVersion: 1 },
    { ...expected, defaultVersion: 3 },
  ]) {
    assert.equal(hasExactCommissionSuggestionReadback([differing], expected), false);
  }
  assert.equal(hasExactCommissionSuggestionReadback([], expected), false);
});

test("unrelated Store Type suggestion cannot stand in for a missing financial readback", () => {
  assert.equal(hasExactCommissionSuggestionReadback([
    { ...expected, commercialStoreTypeId: "pharmacy" },
    { ...expected, fulfillmentMode: "PARTNER_CAPTAIN" },
  ], expected), false);
});
