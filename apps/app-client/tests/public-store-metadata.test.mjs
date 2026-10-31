import assert from "node:assert/strict";
import { test } from "node:test";
import { readPublicStoreMetadata } from "../src/features/store-discovery/public-store-metadata.ts";

const storeId = "store_example";
const cityId = "city_sanaa";
const request = (query) => new Request("https://bthwani.test/store/" + storeId + query);
const published = {
  id: storeId, name: "متجر تجريبي", serviceCity: { id: cityId, displayNameAr: "صنعاء", active: true },
  storeCoverImage: { uri: "https://media.bthwani.test/cover.png" },
};
const response = (value) => new Response(JSON.stringify(value), { status: 200 });
async function metadataFor(req, apiURL, fetcher, publicOrigin = "https://bthwani.test") {
  const previousOrigin = process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN;
  if (publicOrigin === null) delete process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN;
  else process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN = publicOrigin;
  try { return await readPublicStoreMetadata(req, storeId, apiURL, fetcher); }
  finally {
    if (previousOrigin === undefined) delete process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN;
    else process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN = previousOrigin;
  }
}

test("published Store metadata comes from the DSH public projection", async () => {
  let called = "";
  const metadata = await metadataFor(request("?serviceCityId=" + cityId), "http://127.0.0.1:18080", async (url) => { called = String(url); return response(published); });
  assert.equal(called, "http://127.0.0.1:18080/dsh/public/stores/store_example?serviceCityId=city_sanaa");
  assert.equal(metadata.title, "متجر تجريبي | بثواني");
  assert.equal(metadata.openGraph.images, "https://media.bthwani.test/cover.png");
});

test("an unpublished, mismatched or missing Store is not indexable", async () => {
  for (const reply of [new Response(null, { status: 404 }), response({ ...published, id: "different" }), response({ ...published, serviceCity: { id: "other", displayNameAr: "إب" } })]) {
    const metadata = await metadataFor(request("?serviceCityId=" + cityId), "http://127.0.0.1:18080", async () => reply);
    assert.equal(metadata.robots.index, false);
  }
});


test("an inactive or incomplete Service City projection is not indexable", async () => {
  for (const serviceCity of [
    { ...published.serviceCity, active: false },
    { id: cityId, displayNameAr: "", active: true },
    { id: cityId, active: true },
  ]) {
    const metadata = await metadataFor(request("?serviceCityId=" + cityId), "http://127.0.0.1:18080", async () => response({ ...published, serviceCity }));
    assert.equal(metadata.robots.index, false);
  }
});
test("a missing or malformed Service City never triggers a Store fetch", async () => {
  const noFetch = async () => { throw new Error("unexpected network request"); };
  for (const query of ["", "?serviceCityId=unknown%2Fcity", "?serviceCityId="]) {
    const metadata = await metadataFor(request(query), "http://127.0.0.1:18080", noFetch);
    assert.equal(metadata.robots.index, false);
  }
});

test("unsafe cover URLs are excluded from public OG previews", async () => {
  for (const uri of [
    "http://127.0.0.1:18080/internal.png",
    "https://user:pass@media.bthwani.test/cover.png",
    "https://localhost/cover.png",
    "https://media.local/cover.png",
    "https://192.168.1.10/cover.png",
  ]) {
    const metadata = await metadataFor(request("?serviceCityId=" + cityId), "http://127.0.0.1:18080", async () => response({ ...published, storeCoverImage: { uri } }));
    assert.equal(metadata.openGraph.images, undefined, uri);
  }
});

test("an unavailable DSH service yields non-indexable metadata", async () => {
  const metadata = await metadataFor(request("?serviceCityId=" + cityId), "http://127.0.0.1:18080", async () => { throw new Error("unavailable"); });
  assert.equal(metadata.robots.index, false);
});


test("published Store gets a clean canonical URL and social preview without tracking parameters", async () => {
  const req = request("?serviceCityId=" + cityId + "&utm_source=whatsapp&productId=offer_123");
  const metadata = await metadataFor(req, "http://127.0.0.1:18080", async () => response(published));
  const expected = "https://bthwani.test/store/store_example?serviceCityId=city_sanaa";
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.alternates.canonical, expected);
  assert.equal(metadata.openGraph.url, expected);
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.equal(metadata.twitter.images, "https://media.bthwani.test/cover.png");
});

test("a local Store preview is never indexable or published as a social preview", async () => {
  const local = new Request("http://localhost:18101/store/" + storeId + "?serviceCityId=" + cityId);
  const metadata = await metadataFor(local, "http://127.0.0.1:18080", async () => { throw new Error("unexpected fetch"); });
  assert.equal(metadata.robots.index, false);
  assert.equal(metadata.openGraph, undefined);
});

test("canonical metadata ignores an untrusted request Host", async () => {
  const hostileRequest = new Request("https://attacker.example/store/" + storeId + "?serviceCityId=" + cityId);
  const metadata = await metadataFor(hostileRequest, "http://127.0.0.1:18080", async () => response(published));
  const expected = "https://bthwani.test/store/store_example?serviceCityId=city_sanaa";
  assert.equal(metadata.alternates.canonical, expected);
  assert.equal(metadata.openGraph.url, expected);
});

test("missing or unsafe configured public origins never fetch or become indexable", async () => {
  const noFetch = async () => { throw new Error("unexpected network request"); };
  for (const publicOrigin of [null, "http://bthwani.test", "https://user:pass@bthwani.test", "https://bthwani.test/path", "https://localhost"]) {
    const metadata = await metadataFor(request("?serviceCityId=" + cityId), "http://127.0.0.1:18080", noFetch, publicOrigin);
    assert.equal(metadata.robots.index, false, String(publicOrigin));
    assert.equal(metadata.alternates, undefined, String(publicOrigin));
  }
});
