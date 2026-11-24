import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readMerchantInventorySummary, parseMerchantInventorySummary, createMerchantCatalogDraft, listMerchantCatalog, parseMerchantCatalogPage, updateMerchantCatalogDraft, validMerchantCatalogDraft, validMerchantCatalogDraftEdit } from "./merchant-catalog.ts";

const offer = {
  id: "of-a", storeId: "store-a", productId: "p-a", name: "مادة تجريبية",
  variantId: "v-a", priceYer: "1200", stockUnits: 0, draftVersion: 1, productActive: false,
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
test("private catalog forwards literal search with keyset and rejects unsafe terms", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get("q"), "مادة%_");
    assert.equal(params.get("cursor"), "of-a");
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  };
  await listMerchantCatalog("http://127.0.0.1:3202", "store-a", "merchant-a", "synthetic-bearer",
    { query: "مادة%_", cursor: "of-a" });
  for (const query of ["a".repeat(81), "\u0000", "\uD800"]) {
    await assert.rejects(() => listMerchantCatalog("http://127.0.0.1:3202",
      "store-a", "merchant-a", "synthetic-bearer", { query }), { message: "INVALID_REQUEST" });
  }
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

const edited = {
  operationId: "edit-draft-0001", expectedVersion: 1,
  name: "مسودة معدلة", priceYer: "3500", stockUnits: 5,
};
const editedOffer = { ...draftOffer, name: edited.name, priceYer: edited.priceYer,
  stockUnits: edited.stockUnits, draftVersion: 2 };
test("private merchant draft edit targets exact Store/Offer with CAS and authenticated bearer", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:3202/v1/stores/store-a/catalog/of-new");
    assert.equal(init.method, "PATCH");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.Authorization, "Bearer synthetic-bearer");
    assert.deepEqual(JSON.parse(init.body), edited);
    return Response.json({ offer: editedOffer, replay: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  };
  const result = await updateMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "of-new", "synthetic-bearer", edited);
  assert.equal(result.offer.draftVersion, 2);
  assert.equal(calls, 1);
});
test("same draft edit key replays immutable historical version", async () => {
  globalThis.fetch = async () => Response.json({ offer: editedOffer, replay: true }, {
    headers: { "Cache-Control": "no-store" },
  });
  const result = await updateMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "of-new", "synthetic-bearer", edited);
  assert.equal(result.replay, true);
  assert.equal(result.offer.draftVersion, 2);
});
test("edit rejects unapproved or malformed version and cross-Store response before displaying", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ offer: { ...editedOffer, storeId: "store-b" }, replay: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  };
  for (const change of [
    { ...edited, expectedVersion: 0 }, { ...edited, expectedVersion: 1.5 },
    { ...edited, expectedVersion: Number.MAX_SAFE_INTEGER + 2 },
    { ...edited, priceYer: "0" }, { ...edited, stockUnits: -1 },
  ]) {
    assert.equal(validMerchantCatalogDraftEdit(change), false);
    await assert.rejects(() => updateMerchantCatalogDraft(
      "http://127.0.0.1:3202", "store-a", "of-new", "synthetic-bearer", change));
  }
  assert.equal(calls, 0);
  await assert.rejects(() => updateMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "of-new", "synthetic-bearer", edited), {
    message: "OPERATION_RESULT_UNKNOWN",
  });
  assert.equal(calls, 1);
});
test("owner version conflict is explicit and a lost edit acknowledgement remains unknown", async () => {
  globalThis.fetch = async () => Response.json({ code: "CATALOG_DRAFT_VERSION_CONFLICT" }, {
    status: 409, headers: { "Cache-Control": "no-store" },
  });
  await assert.rejects(() => updateMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "of-new", "synthetic-bearer", edited),
    { message: "CATALOG_DRAFT_VERSION_CONFLICT" });
  globalThis.fetch = async () => { throw Error("connection closed after PostgreSQL COMMIT"); };
  await assert.rejects(() => updateMerchantCatalogDraft(
    "http://127.0.0.1:3202", "store-a", "of-new", "synthetic-bearer", edited),
    { message: "OPERATION_RESULT_UNKNOWN" });
});

test("complete inventory summary verifies owner scope and counter invariants", async () => {
  const summary = { actorId: "merchant-a", storeId: "store-a", totalOffers: 132,
    publishedOffers: 120, availableOffers: 115, unavailableOffers: 5, stockoutOffers: 2 };
  assert.deepEqual(parseMerchantInventorySummary(summary, "merchant-a", "store-a"), summary);
  for (const bad of [{...summary, actorId:"merchant-b"}, {...summary, storeId:"store-b"},
    {...summary, stockoutOffers:6}, {...summary, unavailableOffers:4},
    {...summary, publishedOffers:133}, {...summary, totalOffers:-1},
    {...summary, totalOffers:Number.MAX_SAFE_INTEGER+1}, {...summary, extra:0}]) {
    assert.throws(() => parseMerchantInventorySummary(bad,"merchant-a","store-a"), {code:"OWNER_RESPONSE_INVALID"});
  }
  globalThis.fetch = async (url, init) => {
    assert.equal(url,"http://127.0.0.1:3202/v1/stores/store-a/inventory-summary");
    assert.equal(init.method,"GET");
    assert.equal(init.headers.Authorization,"Bearer synthetic-bearer");
    return Response.json(summary,{headers:{"Cache-Control":"no-store"}});
  };
  assert.deepEqual(await readMerchantInventorySummary("http://127.0.0.1:3202","store-a","merchant-a","synthetic-bearer"),summary);
});
