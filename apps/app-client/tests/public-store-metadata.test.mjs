import assert from "node:assert/strict";
import { test } from "node:test";
import { readPublicStoreMetadata } from "../src/features/store-discovery/public-store-metadata.ts";

const storeId = "store_example";
const cityId = "city_sanaa";
const request = (query) => new Request("https://bthwani.test/store/" + storeId + query);
const published = {
  id: storeId, name: "متجر تجريبي", serviceCity: { id: cityId, displayNameAr: "صنعاء" },
  storeCoverImage: { uri: "https://media.bthwani.test/cover.png" },
};
const response = (value) => new Response(JSON.stringify(value), { status: 200 });

test("published Store metadata comes from the DSH public projection", async () => {
  let called = "";
  const metadata = await readPublicStoreMetadata(request("?serviceCityId=" + cityId), storeId, "http://127.0.0.1:18080", async (url) => { called = String(url); return response(published); });
  assert.equal(called, "http://127.0.0.1:18080/dsh/public/stores/store_example?serviceCityId=city_sanaa");
  assert.equal(metadata.title, "متجر تجريبي | بثواني");
  assert.equal(metadata.openGraph.images, "https://media.bthwani.test/cover.png");
});

test("an unpublished, mismatched or missing Store is not indexable", async () => {
  for (const reply of [new Response(null, { status: 404 }), response({ ...published, id: "different" }), response({ ...published, serviceCity: { id: "other", displayNameAr: "إب" } })]) {
    const metadata = await readPublicStoreMetadata(request("?serviceCityId=" + cityId), storeId, "http://127.0.0.1:18080", async () => reply);
    assert.equal(metadata.robots.index, false);
  }
});

test("a missing or malformed Service City never triggers a Store fetch", async () => {
  const noFetch = async () => { throw new Error("unexpected network request"); };
  for (const query of ["", "?serviceCityId=unknown%2Fcity", "?serviceCityId="]) {
    const metadata = await readPublicStoreMetadata(request(query), storeId, "http://127.0.0.1:18080", noFetch);
    assert.equal(metadata.robots.index, false);
  }
});

test("internal development media URLs are excluded from public OG previews", async () => {
  const metadata = await readPublicStoreMetadata(request("?serviceCityId=" + cityId), storeId, "http://127.0.0.1:18080", async () => response({ ...published, storeCoverImage: { uri: "http://127.0.0.1:18080/internal.png" } }));
  assert.equal(metadata.openGraph.images, undefined);
});

test("an unavailable DSH service yields non-indexable metadata", async () => {
  const metadata = await readPublicStoreMetadata(request("?serviceCityId=" + cityId), storeId, "http://127.0.0.1:18080", async () => { throw new Error("unavailable"); });
  assert.equal(metadata.robots.index, false);
});
