import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePublicSearchDraft, normalizeServiceCityId, readPublicSearch, readStoreBrowseScope, serviceCityLabel } from "./serviceability.ts";

test("city scope is normalized but never asserts serviceability", () => {
  assert.equal(normalizeServiceCityId(" SANAA "), "sanaa");
  assert.equal(normalizeServiceCityId("sanaa-1"), "sanaa-1");
  for (const city of ["", "../sanaa", "sanaa/other", "صنعاء", "a".repeat(65)]) {
    assert.equal(normalizeServiceCityId(city), "");
  }
});

test("Store links restore only bounded city and search text", () => {
  assert.deepEqual(readStoreBrowseScope({ city: " ADEN ", q: " مخبز " }, "sanaa"), { city: "aden", q: "مخبز" });
  assert.deepEqual(readStoreBrowseScope({ city: "https://elsewhere.test", q: "�".repeat(81) }, "sanaa"), { city: "sanaa", q: "" });
  assert.deepEqual(readStoreBrowseScope({ city: ["aden", "sanaa"], q: ["first", "second"] }, "sanaa"), { city: "sanaa", q: "" });
  assert.equal(readStoreBrowseScope({ q: "�".repeat(80) }, "sanaa").q, "�".repeat(80));
  assert.equal(readStoreBrowseScope({ vertical: " GROCERY " }, "sanaa").vertical, "grocery");
  for (const unsafe of ["../grocery", "صيدليات", "a".repeat(65)]) {
    assert.equal(readStoreBrowseScope({ vertical: unsafe }, "sanaa").vertical, undefined);
  }
  assert.equal(serviceCityLabel("sanaa"), "صنعاء");
});

test("route search validates raw scalar length before owner-compatible whitespace normalization", () => {
  const q = "a".repeat(80);
  for (const invalid of [q.concat(" "), "\u0085".concat(q), "\u0000", "\ud800"]) {
    assert.equal(readStoreBrowseScope({ q: invalid }, "sanaa").q, "");
  }
  assert.equal(readStoreBrowseScope({ q: "\u0085مخبز\u0085" }, "sanaa").q, "مخبز");
  assert.equal(readStoreBrowseScope({ q: "\ufeffمخبز\ufeff" }, "sanaa").q, "\ufeffمخبز\ufeff");
});

test("public search preserves literal Unicode, validates raw input, and trims exactly Unicode White_Space", () => {
  const whitespace = "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
  for (const scalar of whitespace) assert.equal(readPublicSearch(scalar.concat("مخبز", scalar)), "مخبز");
  assert.equal(readPublicSearch(whitespace), "");
  assert.equal(readPublicSearch("a\u0085b"), "a\u0085b");
  assert.equal(readPublicSearch("\u180e\u200b\ufeff"), "\u180e\u200b\ufeff");
  assert.equal(readPublicSearch("�".repeat(80)), "�".repeat(80));
  for (const value of [null, undefined, ["a"], "�".repeat(81), "bad\u0000query", "\ud800", "\udfff", "a".repeat(80).concat(" ")]) {
    assert.equal(readPublicSearch(value), null);
  }
  assert.equal(capturePublicSearchDraft("�".repeat(80)), "�".repeat(80));
  assert.equal(capturePublicSearchDraft("�".repeat(100)), "�".repeat(81));
  assert.equal(readPublicSearch(capturePublicSearchDraft("�".repeat(100))), null);
});
