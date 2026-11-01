import assert from "node:assert/strict";
import { test } from "node:test";
import { scopedPartnerPopularOffers } from "../src/features/partner-onboarding/partner-home-popularity.ts";

const offer = { offerId: "offer-1", storeId: "store-1", productName: "منتج موثق", publicationState: "published", availability: true };

test("partner home uses only DSH's scoped public popular ranking", () => {
  assert.deepEqual(scopedPartnerPopularOffers("store-1", { storeId: "store-1", offers: [offer] }), [offer]);
  assert.deepEqual(scopedPartnerPopularOffers("store-1", { storeId: "store-1", offers: [] }), []);
});

test("partner home never shows foreign or invalid offers as popular", () => {
  const failures = [
    null,
    { storeId: "store-1" },
    { storeId: "store-2", offers: [offer] },
    { storeId: "store-1", offers: [{ ...offer, storeId: "store-2" }] },
    { storeId: "store-1", offers: [offer, offer] },
    { storeId: "store-1", offers: [{ ...offer, offerId: "" }] },
    { storeId: "store-1", offers: [{ ...offer, productName: "" }] },
    { storeId: "store-1", offers: [{ ...offer, publicationState: "draft" }] },
    { storeId: "store-1", offers: [{ ...offer, availability: false }] },
    { storeId: "store-1", offers: Array.from({ length: 5 }, (_, index) => ({ ...offer, offerId: "offer-" + index })) },
  ];
  for (const failure of failures) assert.equal(scopedPartnerPopularOffers("store-1", failure), null);
});
