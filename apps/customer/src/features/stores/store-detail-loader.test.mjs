import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePublicStoreDetail } from "./store-detail-loader.ts";

const store = Object.freeze({
  id: "store-1", name: "متجر", cityId: "sanaa", verticalId: "grocery",
  orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
});
const offer = Object.freeze({
  id: "offer-1", storeId: "store-1", name: "منتج", variantId: "variant-1",
  priceYer: 1500, available: true,
});
const page = Object.freeze({ items: [offer], nextCursor: "opaque-cursor", revision: 3 });

test("a verified Store and its Offers are both shown when owner reads succeed", async () => {
  const result = await resolvePublicStoreDetail(Promise.resolve(store), Promise.resolve(page));
  assert.equal(result.store.id, store.id);
  assert.deepEqual(result.offers, [offer]);
  assert.equal(result.nextCursor, "opaque-cursor");
  assert.equal(result.offersError, undefined);
});

test("an Offers outage does not hide a separately verified public Store", async () => {
  const result = await resolvePublicStoreDetail(
    Promise.resolve(store), Promise.reject(new Error("OWNER_NETWORK_UNAVAILABLE")),
  );
  assert.equal(result.store.id, store.id);
  assert.deepEqual(result.offers, []);
  assert.equal(result.nextCursor, undefined);
  assert.equal(result.offersError, "OWNER_NETWORK_UNAVAILABLE");
});

test("a hidden or unavailable Store fails closed even if an Offers page was returned", async () => {
  const denied = new Error("NOT_FOUND");
  await assert.rejects(
    resolvePublicStoreDetail(Promise.reject(denied), Promise.resolve(page)),
    (error) => error === denied,
  );
});

test("missing or unknown Offers failure details do not generate a successful empty-catalogue state", async () => {
  const result = await resolvePublicStoreDetail(Promise.resolve(store), Promise.reject(null));
  assert.equal(result.offersError, "UNKNOWN");
  assert.deepEqual(result.offers, []);
});

test("a hidden Store is rejected immediately even if its Offers request never responds", async () => {
  const denied = new Error("NOT_FOUND");
  let timer;
  try {
    await assert.rejects(
      Promise.race([
        resolvePublicStoreDetail(Promise.reject(denied), new Promise(() => {})),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("waited for Offers")), 100); }),
      ]),
      (error) => error === denied,
    );
  } finally {
    clearTimeout(timer);
  }
});
