import assert from "node:assert/strict";
import { test } from "node:test";
import { mayPrepareIndependentStoreBanners } from "./independent-store-banner-access.ts";

test("independent Store owner can prepare only their own draft banners", () => {
  assert.equal(mayPrepareIndependentStoreBanners({ relationModel: "INDEPENDENT_STORE", owned: true }), true);
});
test("marketplace owner cannot enter independent draft banner route", () => {
  assert.equal(mayPrepareIndependentStoreBanners({ relationModel: "BTHWANI_PARTNER", owned: true }), false);
});
test("a delegate cannot edit independent banner drafts via the owner route", () => {
  assert.equal(mayPrepareIndependentStoreBanners({ relationModel: "INDEPENDENT_STORE", owned: false }), false);
});
test("missing or unverified selected Store fails closed", () => {
  assert.equal(mayPrepareIndependentStoreBanners(null), false);
  assert.equal(mayPrepareIndependentStoreBanners(undefined), false);
  assert.equal(mayPrepareIndependentStoreBanners({ relationModel: "", owned: true }), false);
});
