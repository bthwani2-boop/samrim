import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverPublicStoreDetail, resolvePublicStoreDetail } from "./store-detail-loader.ts";

const store = Object.freeze({
  id: "store-1", name: "متجر", cityId: "sanaa", verticalId: "grocery",
  orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
});
const offer = Object.freeze({
  id: "offer-1", storeId: "store-1", name: "منتج", variantId: "variant-1",
  priceYer: 1500, available: true,
});
const page = Object.freeze({ items: [offer], nextCursor: "opaque-cursor", revision: 3 });

test("a later publication denial removes the cached Store, Offers and pagination cursor", () => {
  const cached = { scope: store.id, loading: false, store, offers: [offer], cursor: "page-2", more: true };
  const recovered = recoverPublicStoreDetail(cached, new Error("NOT_FOUND"));
  assert.deepEqual(recovered, { scope: store.id, loading: false, offers: [], error: "NOT_FOUND" });
  assert.equal(cached.store, store, "recovery must not mutate a previous render snapshot");
});

test("stale or invalid pagination discards old prices and restarts at the first page", () => {
  for (const code of ["STALE_CURSOR", "INVALID_CURSOR"]) {
    const recovered = recoverPublicStoreDetail({ scope: store.id, loading: false, store, offers: [offer], cursor: "page-2", more: true }, new Error(code));
    assert.equal(recovered.store, store);
    assert.deepEqual(recovered.offers, []);
    assert.equal(recovered.cursor, undefined);
    assert.equal(recovered.more, false);
    assert.equal(recovered.offersError, code);
  }
});

test("a transient pagination outage retains verified Store and Offers for retrying the same cursor", () => {
  const offers = [offer];
  const recovered = recoverPublicStoreDetail({ scope: store.id, loading: false, store, offers, cursor: "page-2", more: true }, new Error("OWNER_NETWORK_UNAVAILABLE"));
  assert.equal(recovered.store, store);
  assert.equal(recovered.offers, offers);
  assert.equal(recovered.cursor, "page-2");
  assert.equal(recovered.more, false);
  assert.equal(recovered.offersError, "OWNER_NETWORK_UNAVAILABLE");
});

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

test("publication revoked between Store and Offers reads invalidates the previously verified Store", async () => {
  const denied = new Error("NOT_FOUND");
  await assert.rejects(
    resolvePublicStoreDetail(Promise.resolve(store), Promise.reject(denied)),
    error => error === denied,
  );
});

test("an Offers publication denial fails immediately even when the Store read never responds", async () => {
  const denied = new Error("NOT_FOUND");
  let timer;
  try {
    await assert.rejects(Promise.race([
      resolvePublicStoreDetail(new Promise(() => {}), Promise.reject(denied)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("waited for Store")), 100); }),
    ]), error => error === denied);
  } finally {
    clearTimeout(timer);
  }
});
