import assert from "node:assert/strict";
import { test } from "node:test";
import { storeOfferServerQuery } from "./catalog-offer-filters.ts";

test("unfiltered catalog keeps its stable Store-owned page; promotions and popular are separate sources", () => {
  for (const filter of ["all", "offers", "popular"]) {
    assert.equal(storeOfferServerQuery(filter, ""), null);
  }
  assert.equal(storeOfferServerQuery("popular", "شاحن"), null);
});

test("published availability and unavailable are applied by DSH before pagination", () => {
  assert.deepEqual(storeOfferServerQuery("published", ""), { publicationState: "published", availability: "available" });
  assert.deepEqual(storeOfferServerQuery("unavailable", ""), { availability: "unavailable" });
});

test("hidden includes draft and hidden without exposing published offers", () => {
  assert.deepEqual(storeOfferServerQuery("hidden", ""), { publicationState: "not_published" });
});

test("stockout is an inventory-status query, not a local first-page calculation", () => {
  assert.deepEqual(storeOfferServerQuery("stockout", "شاحن"), { q: "شاحن", inventoryStatus: "stockout" });
});

test("search is Store-wide, normalized and bounded to DSH query limits", () => {
  assert.deepEqual(storeOfferServerQuery("all", "  شاحن  "), { q: "شاحن" });
  assert.equal(storeOfferServerQuery("all", "x".repeat(500))?.q?.length, 160);
});
