import assert from "node:assert/strict";
import test from "node:test";

import { buildPartnerOfferShareURL, buildPartnerStorefrontURL, buildPartnerStoreWhatsAppURL } from "../src/features/partner-onboarding/partner-storefront-url.ts";
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


test("published Store may be shared through WhatsApp with preserved Service City and Arabic title", () => {
  const link = buildPartnerStorefrontURL(store, "https://bthwani.example");
  const url = buildPartnerStoreWhatsAppURL(link, "متجرنا");
  assert.ok(url);
  const target = new URL(url);
  assert.equal(target.origin, "https://wa.me");
  assert.equal(target.pathname, "/");
  assert.equal(target.searchParams.get("text"), "متجرنا\\nhttps://bthwani.example/store/store_123?serviceCityId=city_sanaa".replace("\\n", "\n"));
});

test("WhatsApp share never exposes a local preview, unpublished Store, or non-HTTPS URL", () => {
  assert.equal(buildPartnerStoreWhatsAppURL(buildPartnerStorefrontURL(store, "http://localhost:18101", true), "demo"), null);
  assert.equal(buildPartnerStoreWhatsAppURL(buildPartnerStorefrontURL({ ...store, publicationState: "draft" }, "https://bthwani.example"), "demo"), null);
  assert.equal(buildPartnerStoreWhatsAppURL({ url: "javascript:alert(1)", previewOnly: false }, "demo"), null);
  assert.equal(buildPartnerStoreWhatsAppURL({ url: "https://bthwani.example/elsewhere", previewOnly: false }, "demo"), null);
  assert.equal(buildPartnerStoreWhatsAppURL({ url: "https://localhost/store/store_123?serviceCityId=city_sanaa", previewOnly: false }, "demo"), null);
});

test("a published Store can share a specific public product without changing Store/City scope", () => {
  const link = buildPartnerStorefrontURL(store, "https://bthwani.example", false, "product&one");
  assert.equal(link?.url, "https://bthwani.example/store/store_123?serviceCityId=city_sanaa&productId=product%26one");
  const whatsapp = buildPartnerStoreWhatsAppURL(link, "منتج من متجري");
  assert.ok(whatsapp);
  assert.equal(new URL(whatsapp).searchParams.get("text"), "منتج من متجري\n"+link.url);
});

test("product links reject untrusted product input and unsafe WhatsApp query additions", () => {
  for (const id of ["a".repeat(151), "product\nunsafe", "product\0unsafe"]) {
    assert.equal(buildPartnerStorefrontURL(store, "https://bthwani.example", false, id), null);
  }
  assert.equal(buildPartnerStorefrontURL({...store,publicationState:"hidden"}, "https://bthwani.example", false, "product-1"),null);
  assert.equal(buildPartnerStoreWhatsAppURL({url:"https://bthwani.example/store/store_123?serviceCityId=city_sanaa&redirect=https://bad.example",previewOnly:false},"x"),null);
  assert.equal(buildPartnerStoreWhatsAppURL(buildPartnerStorefrontURL(store,"http://localhost:18101",true,"product-1"),"x"),null);
});

test("WhatsApp product link rejects ambiguous duplicate parameters and fragments", () => {
  for (const suffix of [
    "?serviceCityId=city_sanaa&serviceCityId=city_ibb",
    "?serviceCityId=city_sanaa&productId=one&productId=two",
    "?serviceCityId=city_sanaa#private",
    "?serviceCityId=city_sanaa&productId=",
  ]) {
    assert.equal(buildPartnerStoreWhatsAppURL({url:"https://bthwani.example/store/store_123"+suffix,previewOnly:false},"x"),null,suffix);
  }
});

test("published, orderable Offer is shareable only in its own published Store", () => {
  const offer = {storeId:store.id,productId:"product_1",publicationState:"published",availability:true,productActive:true,variantActive:true};
  assert.equal(buildPartnerOfferShareURL(store, offer, "https://bthwani.example")?.url,
    "https://bthwani.example/store/store_123?serviceCityId=city_sanaa&productId=product_1");
  const rejected = [
    {...offer,storeId:"foreign-store"},
    {...offer,productId:""},
    {...offer,publicationState:"draft"},
    {...offer,publicationState:"hidden"},
    {...offer,availability:false},
    {...offer,productActive:false},
    {...offer,variantActive:false},
  ];
  for (const candidate of rejected) {
    assert.equal(buildPartnerOfferShareURL(store,candidate,"https://bthwani.example"),null,JSON.stringify(candidate));
  }
  assert.equal(buildPartnerOfferShareURL({...store,publicationState:"unpublished"},offer,"https://bthwani.example"),null);
  assert.equal(buildPartnerOfferShareURL(store,offer,"http://localhost:18101"),null);
  const local = buildPartnerOfferShareURL(store,offer,"http://localhost:18101",true);
  assert.ok(local?.previewOnly);
  assert.equal(buildPartnerStoreWhatsAppURL(local,"منتج"),null);
});
