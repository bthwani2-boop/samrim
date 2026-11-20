import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeServiceCityId, readStoreBrowseScope, serviceCityLabel } from "./serviceability.ts";

test("city scope is normalized but never asserts serviceability", () => {
  assert.equal(normalizeServiceCityId(" SANAA "), "sanaa");
  assert.equal(normalizeServiceCityId("sanaa-1"), "sanaa-1");
  for (const city of ["", "../sanaa", "sanaa/other", "صنعاء", "a".repeat(65)]) {
    assert.equal(normalizeServiceCityId(city), "");
  }
});

test("Store links restore only bounded city and search text", () => {
  assert.deepEqual(readStoreBrowseScope({ city: " ADEN ", q: " مخبز " }, "sanaa"), { city: "aden", q: "مخبز" });
  assert.deepEqual(readStoreBrowseScope({ city: "https://elsewhere.test", q: "😀".repeat(81) }, "sanaa"), { city: "sanaa", q: "" });
  assert.deepEqual(readStoreBrowseScope({ city: ["aden", "sanaa"], q: ["first", "second"] }, "sanaa"), { city: "sanaa", q: "" });
  assert.equal(readStoreBrowseScope({ q: "😀".repeat(80) }, "sanaa").q, "😀".repeat(80));
  assert.equal(serviceCityLabel("sanaa"), "صنعاء");
});
