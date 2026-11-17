import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeServiceCityId } from "./serviceability.ts";

test("city scope is normalized but never asserts serviceability", () => {
  assert.equal(normalizeServiceCityId(" SANAA "), "sanaa");
  assert.equal(normalizeServiceCityId("sanaa-1"), "sanaa-1");
  for (const city of ["", "../sanaa", "sanaa/other", "صنعاء", "a".repeat(65)]) {
    assert.equal(normalizeServiceCityId(city), "");
  }
});
