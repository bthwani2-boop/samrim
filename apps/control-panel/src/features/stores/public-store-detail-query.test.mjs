import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicStoreDetail, publicStoreDetailHref } from "./public-store-query.ts";

test("store detail links preserve the scoped city and encoded search without an arbitrary destination", () => {
  const detail = parsePublicStoreDetail("market-sanaa", { city: "sanaa", q: " مخبز ", cursor: "Ab_20" });
  assert.deepEqual(detail, { storeId: "market-sanaa", city: "sanaa", query: "مخبز", cursor: "Ab_20" });
  assert.equal(publicStoreDetailHref("market-sanaa", { city: "sanaa", query: "مخبز" }),
    "/merchants/public-stores/market-sanaa?city=sanaa&q=%D9%85%D8%AE%D8%A8%D8%B2");
});

test("Store detail and its return route retain the Operator vertical filter", () => {
  const scope = parsePublicStoreDetail("market-sanaa", { city: "sanaa", vertical: "grocery", q: "market" });
  assert.equal(scope?.vertical, "grocery");
  assert.equal(publicStoreDetailHref("market-sanaa", scope),
    "/merchants/public-stores/market-sanaa?city=sanaa&q=market&vertical=grocery");
});

test("a malformed Store ID, city or continuation never reaches the owner", () => {
  const bad = ["../merchants", "%2f", "store?role=admin", "", "A".repeat(65)];
  for (const id of bad) assert.equal(parsePublicStoreDetail(id, { city: "sanaa" }), null, id);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: "" }), null);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: ["sanaa", "aden"] }), null);
  assert.equal(parsePublicStoreDetail("market-sanaa", { city: "sanaa", cursor: "?" }), null);
});
