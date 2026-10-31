import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicStoreShareURL, buildStoreSharePath } from "../src/features/store-discovery/store-share-link.ts";
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

test("Store and offer sharing use the configured HTTPS customer Web origin", () => {
  const storeURL = buildPublicStoreShareURL("store_1", "city_sanaa", "https://bthwani.example");
  assert.equal(storeURL, "https://bthwani.example/store/store_1?serviceCityId=city_sanaa");
  const offerURL = buildPublicStoreShareURL("store_1", "city_sanaa", "https://bthwani.example/", "offer&one");
  assert.equal(offerURL, "https://bthwani.example/store/store_1?serviceCityId=city_sanaa&productId=offer%26one");
});

test("Missing or insecure origin without development authorization preserves the native deep-link fallback", () => {
  for (const origin of [undefined, "", "http://127.0.0.1:18101", "http://outside.example", "https://localhost:18101", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x=1"]) {
    assert.equal(buildPublicStoreShareURL("store_1", "city_sanaa", origin), null, String(origin));
  }
  assert.equal(buildPublicStoreShareURL("..", "city_sanaa", "https://example.com"), null);
  assert.equal(buildPublicStoreShareURL("store_1", "", "https://example.com"), null);
});

test("explicit local development preview uses localhost without weakening public HTTPS rules", () => {
  const local = buildPublicStoreShareURL("store_1", "city_sanaa", "http://localhost:18101", "", true);
  assert.equal(local, "http://localhost:18101/store/store_1?serviceCityId=city_sanaa");
  assert.equal(buildPublicStoreShareURL("store_1", "city_sanaa", "http://127.0.0.1:18101", "offer1", true), "http://127.0.0.1:18101/store/store_1?serviceCityId=city_sanaa&productId=offer1");
  assert.equal(buildPublicStoreShareURL("store_1", "city_sanaa", "http://localhost:18101"), null);
  for (const invalid of ["http://example.com", "http://localhost:18101/private", "http://localhost:18101?redirect=1", "http://username@localhost:18101", "file:///private"]) {
    assert.equal(buildPublicStoreShareURL("store_1", "city_sanaa", invalid, "", true), null, invalid);
  }
});
