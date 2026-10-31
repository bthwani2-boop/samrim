import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStoreSharePath } from "../src/features/store-discovery/store-share-link.ts";
import { resolveLinkedServiceCityID } from "../src/features/service-city/service-city-preference.ts";

const active = new Set(["city_sanaa", "city_ibb"]);

test("Store links retain the DSH Service City and offer without creating an external redirect", () => {
  const path = buildStoreSharePath("store/alpha", "city_sanaa", "offer&1?");
  const url = new URL(path, "http://127.0.0.1:18101/");
  assert.equal(url.pathname, "/store/store%2Falpha");
  assert.equal(url.searchParams.get("serviceCityId"), "city_sanaa");
  assert.equal(url.searchParams.get("productId"), "offer&1?");
  assert.equal(url.origin, "http://127.0.0.1:18101");
});

test("Store links remain valid when no city or product is known", () => {
  assert.equal(buildStoreSharePath("store_1", ""), "store/store_1");
  assert.equal(buildStoreSharePath("store_1", "city_sanaa"), "store/store_1?serviceCityId=city_sanaa");
});

test("A fresh Store visitor may inherit only an active, DSH-validated city", () => {
  assert.equal(resolveLinkedServiceCityID(null, "city_sanaa", active), "city_sanaa");
  assert.equal(resolveLinkedServiceCityID(null, "unknown_city", active), null);
  assert.equal(resolveLinkedServiceCityID(null, "", active), null);
});

test("A saved valid city always takes precedence over a link and an inactive city never grants a selection", () => {
  assert.equal(resolveLinkedServiceCityID("city_ibb", "city_sanaa", active), "city_ibb");
  assert.equal(resolveLinkedServiceCityID("deleted_city", "unknown_city", active), null);
  assert.equal(resolveLinkedServiceCityID("deleted_city", "city_sanaa", active), "city_sanaa");
});
