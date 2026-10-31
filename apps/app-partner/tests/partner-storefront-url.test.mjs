import assert from "node:assert/strict";
import test from "node:test";

import { buildPartnerStorefrontURL } from "../src/features/partner-onboarding/partner-storefront-url.ts";
import { buildStoreSharePath } from "../../app-client/src/features/store-discovery/store-share-link.ts";

const store = { id: "store_123", serviceCityId: "city_sanaa", publicationState: "published" };

test("published Store uses the same path as the customer Web App", () => {
  const actual = buildPartnerStorefrontURL(store, "https://bthwani.example");
  assert.equal(actual?.url, "https://bthwani.example/" + buildStoreSharePath(store.id, store.serviceCityId));
  assert.equal(actual?.previewOnly, false);
});

test("no link before publication even with a configured public origin", () => {
  for (const state of ["draft", "unpublished", "hidden", ""]) {
    assert.equal(buildPartnerStorefrontURL({ ...store, publicationState: state }, "https://bthwani.example"), null);
  }
});

test("missing, hostile, ambiguous or non-HTTPS public origins fail closed", () => {
  for (const origin of [undefined, "", "http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1", "https://example.com/#fragment", "javascript:alert(1)", "https://localhost:18101", "http://127.0.0.1:18101"]) {
    assert.equal(buildPartnerStorefrontURL(store, origin), null, String(origin));
  }
});

test("explicit loopback preview works only when enabled and is never public", () => {
  const result = buildPartnerStorefrontURL(store, "http://localhost:18101", true);
  assert.equal(result?.previewOnly, true);
  assert.equal(result?.url, "http://localhost:18101/" + buildStoreSharePath(store.id, store.serviceCityId));
  assert.equal(buildPartnerStorefrontURL(store, "http://example.com", true), null);
});

test("untrusted Store identifiers and cities never enter shared links", () => {
  assert.equal(buildPartnerStorefrontURL({ ...store, id: "../private" }, "https://bthwani.example"), null);
  assert.equal(buildPartnerStorefrontURL({ ...store, id: ".." }, "https://bthwani.example"), null);
  assert.equal(buildPartnerStorefrontURL({ ...store, id: "." }, "https://bthwani.example"), null);
  assert.equal(buildPartnerStorefrontURL({ ...store, serviceCityId: "city?hack=1" }, "https://bthwani.example"), null);
});
