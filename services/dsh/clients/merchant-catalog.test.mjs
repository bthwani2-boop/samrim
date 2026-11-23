import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMerchantCatalogDraft, listMerchantCatalog, parseMerchantCatalogPage, validMerchantCatalogDraft } from "./merchant-catalog.ts";

const offer = {
  id: "of-a", storeId: "store-a", productId: "p-a", name: "مادة تجريبية",
  variantId: "v-a", priceYer: "1200", stockUnits: 0, productActive: false,
  variantSellable: false, requiredAttributesValid: false, published: false, available: false,
};
const page = { actorId: "merchant-a", storeId: "store-a", items: [offer] };
const clone = value => structuredClone(value);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("private draft is visible only in its exact owner actor and Store scope", () => {
  assert.deepEqual(parseMerchantCatalogPage(clone(page), "merchant-a", "store-a"), page);
  assert.throws(() => parseMerchantCatalogPage(clone(page), "merchant-b", "store-a"), { message: "OWNER_RESPONSE_INVALID" });
  assert.throws(() => parseMerchantCatalogPage(clone(page), "merchant-a", "store-b"), { message: "OWNER_RESPONSE_INVALID" });
  assert.throws(() => parseMerchantCatalogPage({ ...page, items: [{ ...offer, storeId: "store-b" }] }, "merchant-a", "store-a"));
});
test("private catalog rejects invalid amounts, duplicate ids, broken cursor and unknown fields", () => {
  assert.throws(() => parseMerchantCatalogPage({ ...page, items: [{ ...offer, priceYer: "9223372036854775808" }] }, "merchant-a", "store-a"));
  assert.throws(() => parseMerchantCatalogPage({ ...page, items: [{ ...offer, priceYer: "001" }] }, "merchant-a", "store-a"));
  assert.throws(() => parseMerchantCatalogPage({ ...page, items: [offer, offer] }, "merchant-a", "store-a"));
  assert.throws(() => parseMerchantCatalogPage({ ...page, nextCursor: "different" }, "merchant-a", "store-a"));
  assert.throws(() => parseMerchantCatalogPage({ ...page, extraActor: "merchant-b" }, "merchant-a", "store-a"));
});
test("owner GET carries bearer and keyset only to local DSH without browser cookies", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:3202/v1/stores/store-a/catalog?limit=20");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.Authorization, "Bearer synthetic-bearer");
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  };
  assert.deepEqual(await listMerchantCatalog("http://127.0.0.1:3202",
    "store-a", "merchant-a", "synthetic-bearer", { limit: 20 }), page);
  assert.equal(calls, 1);
});
test("owner failure, cacheable response and account switches fail closed", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(page), {
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(() => listMerchantCatalog("http://127.0.0.1:3202",
    "store-a", "merchant-a", "synthetic-bearer"));
  await assert.rejects(() => listMerchantCatalog("http://evil.invalid",
    "store-a", "merchant-a", "synthetic-bearer"));
  await assert.rejects(() => listMerchantCatalog("http://127.0.0.1:3202",
    "store-a", "merchant-b", "synthetic-bearer"));
});

const draftCommand = { operationId: "create-draft-0001", name: "مسودة", priceYer: "2400", stockUnits: 3 };
const draftOffer = {
  ...offer, id: "of-new", name: "مسودة", priceYer: "2400", stockUnits: 3,
};
test("creating a Store draft sends an idempotent POST with bearer and no cookies", async () => {
  let seen = 0;
  globalThis.fetch = async (url, init) => {
    seen++;
    assert.equal(url, "http://127.0.0.1:3202/v1/stores/store-a/catalog");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.Authorization, "Bearer synthetic-bearer");
    assert.deepEqual(JSON.parse(init.body), draftCommand);
    return Response.json({ offer: draftOffer, replay: false }, {
      status: 201, headers: { "Cache-Control": "no-store" },
    });
  };
  const result = await createMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "synthetic-bearer", draftCommand);
  assert.equal(result.offer.id, "of-new");
  assert.equal(result.replay, false);
  assert.equal(seen, 1);
});
test("idempotent replay returns the same owner Offer and no duplicate", async () => {
  globalThis.fetch = async () => Response.json({ offer: draftOffer, replay: true }, {
    status: 200, headers: { "Cache-Control": "no-store" },
  });
  assert.deepEqual(await createMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "synthetic-bearer", draftCommand), {
    offer: draftOffer, replay: true,
  });
});
test("invalid or unsafe Merchant draft is denied before dispatch", async () => {
  let called = 0;
  globalThis.fetch = async () => { called++; throw Error("should never dispatch"); };
  for (const change of [
    { ...draftCommand, operationId: "short" },
    { ...draftCommand, name: "" },
    { ...draftCommand, priceYer: "0" },
    { ...draftCommand, priceYer: "9223372036854775808" },
    { ...draftCommand, stockUnits: -1 },
    { ...draftCommand, stockUnits: 2147483648 },
  ]) {
    assert.equal(validMerchantCatalogDraft(change), false);
    await assert.rejects(() => createMerchantCatalogDraft(
      "http://127.0.0.1:3202", "store-a", "synthetic-bearer", change));
  }
  assert.equal(called, 0);
});
test("owner cannot claim a draft was published or for another Store", async () => {
  globalThis.fetch = async () => Response.json({
    offer: { ...draftOffer, published: true }, replay: false,
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
  await assert.rejects(() => createMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "synthetic-bearer", draftCommand), {
    message: "OPERATION_RESULT_UNKNOWN",
  });
});
test("lost draft write acknowledgment stays unknown and must reuse the operation ID", async () => {
  globalThis.fetch = async () => { throw Error("connection closed after commit"); };
  await assert.rejects(() => createMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "synthetic-bearer", draftCommand), {
    message: "OPERATION_RESULT_UNKNOWN",
  });
});
