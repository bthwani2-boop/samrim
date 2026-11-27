import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as ownerClient from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { GET, PATCH, POST } from "../app/api/admission+api.ts";
import * as merchantOwnerWeb from "../src/features/access/merchant-owner-web.ts";

const origin = "http://127.0.0.1:13310";
const dsh = "http://127.0.0.1:13311";
const bearer = Buffer.alloc(32, 12).toString("base64url");
const offer = {
  id: "of-draft", storeId: "store-a", productId: "product-a",
  name: "مسودة متجر", variantId: "variant-a", priceYer: "1200",
  stockUnits: 0, draftVersion: 1, productActive: false, variantSellable: false,
  requiredAttributesValid: false, published: false, available: false,
};
const catalog = { actorId: "merchant-a", storeId: "store-a", items: [offer] };
const draftHistory = { actorId: "merchant-a", storeId: "store-a", offerId: "of-draft", entries: [{
  version: 2, previousPriceYer: "9007199254740993", priceYer: "9007199254740994",
  previousStockUnits: 0, stockUnits: 4, committedAt: "2026-11-27T10:09:35Z",
}] };
function request(search = "?catalog=store-a&limit=20", actor = "merchant-a", token = bearer) {
  return new Request("http://localhost:18102/api/admission" + search, {
    headers: {
      ...(token ? { Cookie: "bthwani_merchant_admission=" + token } : {}),
      "X-Merchant-Context": actor,
      "X-Actor-ID": "merchant-b",
      "X-Role": "operator",
    },
  });
}
function ownerMocks(t, { role = "merchant", ownerStatus = 200, ownerPage = catalog, draft = false, edit = false,
  expectedSearch = "?limit=20", inventory = false, history = false } = {}) {
  const env = {
    MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN,
    MERCHANT_SYNTHETIC_DSH_ORIGIN: process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN,
  };
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = origin;
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN = dsh;
  t.after(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, config) => {
    const target = new URL(url);
    calls.push(target.pathname);
    assert.equal(config.credentials, "omit");
    assert.equal(config.headers.Authorization, "Bearer " + bearer);
    assert.equal(config.headers["X-Actor-ID"], undefined);
    if (target.origin === origin) {
      assert.equal(target.pathname, "/v1/sessions/current");
      return Response.json({ actorId: "merchant-a", role, sessionExpiresAt:
        new Date(Date.now()+120000).toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    assert.equal(target.origin, dsh);
    if (edit) {
      assert.equal(target.pathname, "/v1/stores/store-a/catalog/of-draft");
      assert.equal(config.method, "PATCH");
      assert.equal(target.search, "");
      assert.deepEqual(JSON.parse(config.body), editChange);
      return Response.json(ownerStatus===200 ? {
        offer: { ...offer, name: editChange.name, priceYer: editChange.priceYer,
          stockUnits: editChange.stockUnits, draftVersion: 2 },
        replay: false,
      } : { code: "CATALOG_DRAFT_VERSION_CONFLICT" }, {
        status: ownerStatus, headers: { "Cache-Control": "no-store" },
      });
    }
    if (inventory) {
      assert.equal(target.pathname, "/v1/stores/store-a/inventory-summary");
      assert.equal(target.search, "");
      return Response.json(ownerStatus === 200 ? ownerPage : {code:"STORE_OPERATION_FORBIDDEN"},
        {status:ownerStatus,headers:{"Cache-Control":"no-store"}});
    }
    if (history) {
      assert.equal(target.pathname, "/v1/stores/store-a/catalog/of-draft/draft-history");
      assert.equal(target.search, expectedSearch);
      assert.equal(config.method, "GET");
      return noStore(ownerStatus === 200 ? ownerPage : { code: "STORE_OPERATION_FORBIDDEN" }, ownerStatus);
    }
    assert.equal(target.pathname, "/v1/stores/store-a/catalog");
    if (draft) {
      assert.equal(config.method, "POST");
      assert.equal(target.search, "");
      assert.deepEqual(JSON.parse(config.body), create);
      return Response.json({
        offer: { ...offer, id: "of-new", name: "مسودة جديدة", priceYer: "2500", stockUnits: 4 },
        replay: ownerStatus === 200,
      }, { status: ownerStatus, headers: { "Cache-Control": "no-store" } });
    }
    assert.equal(target.search, expectedSearch);
    return Response.json(ownerStatus === 200 ? ownerPage : { code: "STORE_OPERATION_FORBIDDEN" },
      { status: ownerStatus, headers: { "Cache-Control": "no-store" } });
  });
  return calls;
}

test("private Merchant Catalog BFF uses current actor and Store-bound owner GET", async t => {
  const calls = ownerMocks(t);
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { catalog });
  assert.deepEqual(calls, ["/v1/sessions/current", "/v1/stores/store-a/catalog"]);
});
test("private Merchant Catalog forwards search and rejects ambiguous search before owner calls", async t => {
  const params = new URLSearchParams({ limit: "20", q: "مسودة%_" });
  const calls = ownerMocks(t, { expectedSearch: "?" + params.toString() });
  const response = await GET(request("?catalog=store-a&" + params.toString()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { catalog });
  assert.equal(calls.length, 2);
  for (const search of ["q=a&q=b", "q=%00", "q=%FF", "q=%ZZ", "q=" + "a".repeat(81)]) {
    const invalid = await GET(request("?catalog=store-a&" + search));
    assert.equal(invalid.status, 400);
  }
  assert.equal(calls.length, 2);
});
test("private catalog status is forwarded before paging and rejects invalid selectors", async t => {
  const calls = ownerMocks(t, { expectedSearch: "?limit=1&status=unpublished" });
  const response = await GET(request("?catalog=store-a&limit=1&status=unpublished"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { catalog });
  for (const selector of ["status=", "status=invalid", "status=published&status=stockout"]) {
    assert.equal((await GET(request("?catalog=store-a&" + selector))).status, 400);
  }
  assert.equal(calls.length, 2);
});
test("private Merchant Catalog never reads Identity without a bearer", async t => {
  const calls = ownerMocks(t);
  assert.equal((await GET(request(undefined, "merchant-a", ""))).status, 401);
  assert.equal(calls.length, 0);
});
test("foreign actor context denied before DSH and never cleared as a valid session", async t => {
  const calls = ownerMocks(t);
  const reply = await GET(request(undefined, "merchant-b"));
  assert.equal(reply.status, 403);
  assert.deepEqual(calls, ["/v1/sessions/current"]);
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
test("foreign Store denial is not converted to an empty catalog", async t => {
  const calls = ownerMocks(t, { ownerStatus: 403 });
  const reply = await GET(request());
  assert.equal(reply.status, 403);
  assert.deepEqual(await reply.json(), { code: "STORE_OPERATION_FORBIDDEN" });
  assert.equal(calls.length, 2);
});
test("wrong actor in DSH response cannot display another account's products", async t => {
  const calls = ownerMocks(t, { ownerPage: { ...catalog, actorId: "merchant-b" } });
  const reply = await GET(request());
  assert.equal(reply.status, 503);
  assert.equal(calls.length, 2);
});
test("invalid, duplicated and injected catalog selectors never reach owners", async t => {
  const calls = ownerMocks(t);
  for (const query of [
    "?catalog=", "?catalog=store-a&catalog=store-b", "?catalog=store-a&limit=00",
    "?catalog=store-a&limit=51", "?catalog=store-a&cursor=../store-b",
    "?catalog=store-a&actorId=merchant-b", "?catalog=store-a&cursor=a&cursor=b",
  ]) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
  assert.equal(calls.length, 0);
});

const create = { operationId: "create-draft-0001", name: "مسودة جديدة", priceYer: "2500", stockUnits: 4 };
function draftRequest(actor = "merchant-a", data = create) {
  return new Request("http://localhost:18102/api/admission?catalog=store-a", {
    method: "POST",
    headers: {
      Cookie: "bthwani_merchant_admission=" + bearer,
      "X-Merchant-Context": actor, "Content-Type": "application/json",
      Origin: "http://localhost:18102",
    },
    body: JSON.stringify(data),
  });
}
test("Merchant draft creation confirms the same DSH owner transaction, without publication", async t => {
  const calls = ownerMocks(t, { draft: true, ownerStatus: 201 });
  const reply = await POST(draftRequest());
  assert.equal(reply.status, 201);
  const { draft } = await reply.json();
  assert.equal(draft.replay, false);
  assert.equal(draft.offer.published, false);
  assert.deepEqual(calls, ["/v1/sessions/current", "/v1/stores/store-a/catalog"]);
});
test("Merchant draft replay is one existing result, not a new operation", async t => {
  const calls = ownerMocks(t, { draft: true, ownerStatus: 200 });
  const reply = await POST(draftRequest());
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).draft.replay, true);
  assert.equal(calls.length, 2);
});
test("Merchant draft rejects foreign actor and never calls DSH", async t => {
  const calls = ownerMocks(t, { draft: true, ownerStatus: 201 });
  const reply = await POST(draftRequest("merchant-b"));
  assert.equal(reply.status, 403);
  assert.deepEqual(calls, ["/v1/sessions/current"]);
});
test("Merchant draft rejects malformed or excessive stock before contacting owner", async t => {
  const calls = ownerMocks(t, { draft: true, ownerStatus: 201 });
  for (const change of [
    { ...create, stockUnits: 2147483648 },
    { ...create, operationId: "short" },
    { ...create, extra: "operator" },
    { ...create, priceYer: "9223372036854775808" },
  ]) {
    assert.equal((await POST(draftRequest("merchant-a", change))).status, 400);
  }
  assert.equal(calls.length, 0);
});
test("Merchant draft cannot accept a successful but published owner result", async t => {
  const calls = ownerMocks(t, { draft: true, ownerStatus: 201 });
  const reply = await POST(draftRequest());
  assert.equal(reply.status, 201);
  assert.equal(calls.length, 2);
});

const editChange = {
  operationId: "edit-draft-0001", expectedVersion: 1,
  name: "مسودة معدلة", priceYer: "3500", stockUnits: 2,
};
function editRequest(actor = "merchant-a", data = editChange, query = "?catalog=store-a&offer=of-draft") {
  return new Request("http://localhost:18102/api/admission" + query, {
    method: "PATCH",
    headers: {
      Cookie: "bthwani_merchant_admission=" + bearer,
      "X-Merchant-Context": actor, "Content-Type": "application/json",
      Origin: "http://localhost:18102",
    },
    body: JSON.stringify(data),
  });
}
test("verified Merchant draft edit uses original actor, owner and expected version", async t => {
  const calls = ownerMocks(t, { edit: true });
  const reply = await PATCH(editRequest());
  assert.equal(reply.status, 200);
  const { edit } = await reply.json();
  assert.equal(edit.offer.draftVersion, 2);
  assert.equal(edit.offer.published, false);
  assert.deepEqual(calls, ["/v1/sessions/current", "/v1/stores/store-a/catalog/of-draft"]);
});
test("wrong Merchant actor never reaches draft editor", async t => {
  const calls = ownerMocks(t, { edit: true });
  assert.equal((await PATCH(editRequest("merchant-b"))).status, 403);
  assert.deepEqual(calls, ["/v1/sessions/current"]);
});
test("missing, repeated and injected edit selectors reject without owner calls", async t => {
  const calls = ownerMocks(t, { edit: true });
  for (const query of [
    "?catalog=store-a", "?catalog=store-a&offer=of-draft&offer=foreign",
    "?catalog=store-a&offer=../foreign",
    "?catalog=store-a&offer=of-draft&actor=merchant-b",
    "?catalog=store-a&catalog=store-b",
  ]) assert.equal((await PATCH(editRequest("merchant-a", editChange, query))).status, 400, query);
  assert.equal(calls.length, 0);
});
test("malformed draft edit version never reaches Identity or DSH", async t => {
  const calls = ownerMocks(t, { edit: true });
  for (const body of [
    { ...editChange, expectedVersion: 0 },
    { ...editChange, expectedVersion: "1" },
    { ...editChange, priceYer: "0" },
    { ...editChange, extra: "operator" },
  ]) {
    const reply = await PATCH(editRequest("merchant-a", body));
    assert.equal(reply.status, 400);
  }
  // The HTTP BFF authenticates the actor before validating the operation, but never writes DSH.
  assert.equal(calls.filter(path => path.endsWith("catalog/of-draft")).length, 0);
});
test("DSH draft conflict stays 409 instead of inventing the next version", async t => {
  const calls = ownerMocks(t, { edit: true, ownerStatus: 409 });
  const reply = await PATCH(editRequest());
  assert.equal(reply.status, 409);
  assert.deepEqual(await reply.json(), { code: "CATALOG_DRAFT_VERSION_CONFLICT" });
  assert.equal(calls.length, 2);
});

test("inventory summary BFF delegates to the complete owner summary and denies foreign context", async t => {
  const inventory = {actorId:"merchant-a",storeId:"store-a",totalOffers:130,
    publishedOffers:120,availableOffers:110,unavailableOffers:10,stockoutOffers:3};
  const calls = ownerMocks(t,{inventory:true,ownerPage:inventory});
  const reply = await GET(request("?inventory=store-a"));
  assert.equal(reply.status,200);
  assert.equal(reply.headers.get("Cache-Control"),"no-store");
  assert.deepEqual(await reply.json(),{inventory});
  assert.deepEqual(calls,["/v1/sessions/current","/v1/stores/store-a/inventory-summary"]);
  assert.equal((await GET(request("?inventory=store-a","merchant-b"))).status,403);
  assert.equal((await GET(request("?inventory=store-a","merchant-a",""))).status,401);
  assert.equal((await GET(request("?inventory=store-a&limit=1"))).status,400);
  assert.equal(calls.length,3);
});

test("Draft history BFF binds Merchant session, Store, offer and the owner page", async t => {
  const calls = ownerMocks(t, { history: true, ownerPage: draftHistory, expectedSearch: "?limit=20&beforeVersion=3" });
  const search = "?draftHistory=store-a&offer=of-draft&beforeVersion=3";
  const result = await GET(request(search));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await result.json(), { draftHistory });
  assert.deepEqual(calls, ["/v1/sessions/current", "/v1/stores/store-a/catalog/of-draft/draft-history"]);
  assert.equal((await GET(request(search, "merchant-b"))).status, 403);
  assert.equal((await GET(request(search, "merchant-a", ""))).status, 401);
  for (const invalid of ["&offer=of-other", "&catalog=store-a", "&limit=999", "&cursor=other"]) {
    assert.equal((await GET(request(search + invalid))).status, 400);
  }
  assert.equal(calls.filter(value => value.endsWith("/draft-history")).length, 1);
});

test("Draft history BFF withholds a mismatched owner offer", async t => {
  const calls = ownerMocks(t, { history: true, ownerPage: { ...draftHistory, offerId: "of-stranger" } });
  const result = await GET(request("?draftHistory=store-a&offer=of-draft"));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).draftHistory, undefined);
  assert.equal(calls.length, 2);
});

test("Draft history BFF preserves an owner refusal", async t => {
  const calls = ownerMocks(t, { history: true, ownerStatus: 403 });
  const result = await GET(request("?draftHistory=store-a&offer=of-draft"));
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { code: "STORE_OPERATION_FORBIDDEN" });
  assert.equal(calls.length, 2);
});

// Exercise the actual app transport, not only the BFF and its owner SDK.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
function catalogTransport(platform, withNativeMerchantSession) {
  const temp = mkdtempSync(path.join(tmpdir(), "merchant-catalog-transport-"));
  try {
    const root = path.resolve(import.meta.dirname, "../../..");
    const source = path.resolve(import.meta.dirname, "../src/features/catalog/catalog-transport.ts");
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--inlineSourceMap", "--inlineSources", "--outDir", temp,
    ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const mod = loadMappedRenderFixture(readFileSync(path.join(temp, "catalog-transport.js"), "utf8"), source, {
      "@bthwani/dsh": ownerClient,
      "react-native": { Platform: { OS: platform } },
      "../access/admission-transport": { withNativeMerchantSession },
      "../access/merchant-owner-web.ts": merchantOwnerWeb,
    });
    loadedModules.push(mod);
    return mod.exports;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
const testActor = "merchant-a", testStore = "store-a";
const newDraft = { offer: { ...offer, id: "of-new", name: create.name, priceYer: create.priceYer, stockUnits: create.stockUnits }, replay: false };
const editedDraft = { offer: { ...offer, name: editChange.name, priceYer: editChange.priceYer, stockUnits: editChange.stockUnits, draftVersion: 2 }, replay: false };
const stockSummary = { actorId: testActor, storeId: testStore, totalOffers: 130, publishedOffers: 120, availableOffers: 110, unavailableOffers: 10, stockoutOffers: 3 };
const noStore = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

test("Web and Android draft history transports share owner validation and forward the same cursor", async t => {
  const signal = new AbortController().signal;
  const web = catalogTransport("web", () => assert.fail("Web must use the same-origin session"));
  const android = catalogTransport("android", async (supplied, action, actor) => {
    assert.equal(supplied, signal);
    assert.equal(actor, testActor);
    return action(bearer, dsh);
  });
  let page = draftHistory;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const address = new URL(url, "http://localhost");
    calls.push([address.pathname, Object.fromEntries(address.searchParams)]);
    if (address.pathname === "/api/admission") {
      assert.equal(options.headers["X-Merchant-Context"], testActor);
      return noStore({ draftHistory: page });
    }
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    return noStore(page);
  });
  for (const transport of [web, android]) {
    assert.deepEqual(await transport.readMerchantCatalogDraftHistory(testStore, "of-draft", testActor, signal, "3"), draftHistory);
  }
  assert.deepEqual(calls, [
    ["/api/admission", { draftHistory: testStore, offer: "of-draft", limit: "20", beforeVersion: "3" }],
    ["/v1/stores/store-a/catalog/of-draft/draft-history", { limit: "20", beforeVersion: "3" }],
  ]);
  page = { ...draftHistory, actorId: "merchant-b" };
  for (const transport of [web, android]) {
    await assert.rejects(transport.readMerchantCatalogDraftHistory(testStore, "of-draft", testActor, signal),
      { code: "OWNER_RESPONSE_INVALID" });
  }
});

test("Web catalog transport binds selectors and validates owner pages and inventory", async t => {
  const transport = catalogTransport("web", () => assert.fail("Web must not use native credentials"));
  const signal = new AbortController().signal;
  const calls = [];
  let respond = () => noStore({ catalog });
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return respond(); });
  const read = options => transport.readMerchantCatalogPage(testStore, testActor, signal, options);
  const inventory = () => transport.readMerchantInventorySummary(testStore, testActor, signal);
  assert.deepEqual(await read({ limit: 20, cursor: "of-a", query: "مسودة%_", status: "unpublished" }), catalog);
  assert.deepEqual(Object.fromEntries(new URL(calls[0].url, "http://localhost").searchParams), {
    catalog: testStore, limit: "20", cursor: "of-a", q: "مسودة%_", status: "unpublished",
  });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.notEqual(calls[0].options.signal, signal);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.deepEqual(calls[0].options, { method: "GET", signal: calls[0].options.signal, credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "X-Merchant-Context": testActor } });
  respond = () => noStore({ inventory: stockSummary });
  assert.deepEqual(await inventory(), stockSummary);
  assert.equal(calls[1].url, "/api/admission?inventory=store-a");
  for (const args of [
    ["../store", testActor, signal], [testStore, "", signal], [testStore, testActor, AbortSignal.abort()],
    [testStore, testActor, signal, { query: "x".repeat(81) }], [testStore, testActor, signal, { status: "invalid" }],
  ]) await assert.rejects(transport.readMerchantCatalogPage(...args), { code: "INVALID_REQUEST" });
  await assert.rejects(transport.readMerchantInventorySummary("../store", testActor, signal), { code: "INVALID_REQUEST" });
  assert.equal(calls.length, 2);
  for (const body of [{ ...catalog, actorId: "merchant-b" }, { ...catalog, storeId: "store-b" }]) {
    respond = () => noStore({ catalog: body });
    await assert.rejects(read(), { code: "OWNER_RESPONSE_INVALID" });
  }
  respond = () => noStore({ catalog });
  await assert.rejects(read({ status: "published" }), { code: "OWNER_RESPONSE_INVALID" });
  respond = () => noStore({ inventory: { ...stockSummary, storeId: "store-b" } });
  await assert.rejects(inventory(), { code: "OWNER_RESPONSE_INVALID" });
  for (const operation of [read, inventory]) {
    respond = () => new Response("invalid JSON", { status: 200 });
    await assert.rejects(operation(), { code: "OWNER_RESPONSE_INVALID" });
    respond = () => Response.json({});
    await assert.rejects(operation(), { code: "OWNER_RESPONSE_INVALID" });
    respond = () => noStore({}, 201);
    await assert.rejects(operation(), { code: "OWNER_RESPONSE_INVALID" });
    respond = () => noStore({ code: "STORE_OPERATION_FORBIDDEN" }, 403);
    await assert.rejects(operation(), { status: 403, code: "STORE_OPERATION_FORBIDDEN" });
    respond = () => noStore([], 503);
    await assert.rejects(operation(), { status: 503, code: "OWNER_UNAVAILABLE" });
  }
  const before = new AbortController();
  respond = () => { before.abort(); return noStore({ catalog }); };
  await assert.rejects(transport.readMerchantCatalogPage(testStore, testActor, before.signal), { code: "OWNER_RESPONSE_STALE" });
  for (const method of [
    transport.readMerchantCatalogPage,
    transport.readMerchantInventorySummary,
  ]) {
    const late = new AbortController();
    respond = () => new Response(new ReadableStream({ pull() { late.abort(); } }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    await assert.rejects(method(testStore, testActor, late.signal), { code: "OWNER_RESPONSE_STALE" });
  }
});

test("Web draft writes preserve operation identity and reject unknown or conflicting acknowledgements", async t => {
  const transport = catalogTransport("web", () => assert.fail("Web must not use native credentials"));
  const signal = new AbortController().signal;
  const calls = [];
  let respond = () => noStore({ draft: newDraft }, 201);
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return respond(); });
  const post = (s = signal) => transport.submitMerchantCatalogDraft(testStore, testActor, create, s);
  const patch = (s = signal) => transport.submitMerchantCatalogDraftEdit(testStore, offer.id, testActor, editChange, s);
  assert.deepEqual(await post(), newDraft);
  assert.equal(calls[0].url, "/api/admission?catalog=store-a");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.notEqual(calls[0].options.signal, signal);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.deepEqual(calls[0].options, { method: "POST", signal: calls[0].options.signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", "X-Merchant-Context": testActor }, body: JSON.stringify(create) });
  respond = () => noStore({ draft: { ...newDraft, replay: true } });
  assert.deepEqual(await post(), { ...newDraft, replay: true });
  respond = () => noStore({ edit: editedDraft });
  assert.deepEqual(await patch(), editedDraft);
  assert.equal(calls[2].url, "/api/admission?catalog=store-a&offer=of-draft");
  assert.equal(calls[2].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[2].options.body), editChange);
  await assert.rejects(transport.submitMerchantCatalogDraft("../store", testActor, create, signal), { code: "INVALID_STORE_DRAFT" });
  await assert.rejects(transport.submitMerchantCatalogDraftEdit(testStore, "../offer", testActor, editChange, signal), { code: "INVALID_STORE_DRAFT" });
  assert.equal(calls.length, 3);
  respond = () => noStore({ draft: { ...newDraft, replay: false } }, 200);
  await assert.rejects(post(), { code: "OPERATION_RESULT_UNKNOWN" });
  respond = () => noStore({ draft: { ...newDraft, offer: { ...newDraft.offer, published: true } } }, 201);
  await assert.rejects(post(), { code: "OPERATION_RESULT_UNKNOWN" });
  respond = () => noStore({ edit: { ...editedDraft, offer: { ...editedDraft.offer, storeId: "store-b" } } });
  await assert.rejects(patch(), { code: "OPERATION_RESULT_UNKNOWN" });
  for (const operation of [post, patch]) {
    respond = () => { throw new Error("lost acknowledgement"); };
    await assert.rejects(operation(), { code: "OPERATION_RESULT_UNKNOWN" });
    respond = () => new Response("invalid JSON", { status: 200 });
    await assert.rejects(operation(), { code: "OPERATION_RESULT_UNKNOWN" });
    respond = () => noStore({ code: "OWNER_UNAVAILABLE" }, 503);
    await assert.rejects(operation(), { code: "OPERATION_RESULT_UNKNOWN" });
    respond = () => noStore({ code: "CATALOG_DRAFT_VERSION_CONFLICT" }, 409);
    await assert.rejects(operation(), { code: "CATALOG_DRAFT_VERSION_CONFLICT" });
    respond = () => noStore([], 400);
    await assert.rejects(operation(), { code: "OPERATION_RESULT_UNKNOWN" });
    respond = () => Response.json({});
    await assert.rejects(operation(), { code: "OPERATION_RESULT_UNKNOWN" });
    respond = () => noStore({}, 202);
    await assert.rejects(operation(), { code: "OPERATION_RESULT_UNKNOWN" });
    const late = new AbortController();
    respond = () => new Response(new ReadableStream({ pull() { late.abort(); } }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    await assert.rejects(operation(late.signal), { code: "OPERATION_RESULT_UNKNOWN" });
  }
});

test("Android catalog transport invokes the canonical DSH client under the same verified actor", async t => {
  const scopes = [], calls = [];
  const transport = catalogTransport("android", async (signal, invoke, actor, write = false) => {
    scopes.push({ signal, actor, write });
    return invoke("synthetic", dsh);
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    calls.push({ target, options });
    if (options.method === "POST") return noStore(newDraft, 201);
    if (options.method === "PATCH") return noStore(editedDraft);
    return noStore(target.pathname.endsWith("inventory-summary") ? stockSummary : catalog);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await transport.readMerchantCatalogPage(testStore, testActor, signal), catalog);
  assert.deepEqual(await transport.readMerchantInventorySummary(testStore, testActor, signal), stockSummary);
  assert.deepEqual(await transport.submitMerchantCatalogDraft(testStore, testActor, create, signal), newDraft);
  assert.deepEqual(await transport.submitMerchantCatalogDraftEdit(testStore, offer.id, testActor, editChange, signal), editedDraft);
  assert.deepEqual(scopes, [false, false, true, true].map(write => ({ signal, actor: testActor, write })));
  assert.deepEqual(calls.map(call => [call.options.method, call.target.pathname]), [
    ["GET", "/v1/stores/store-a/catalog"], ["GET", "/v1/stores/store-a/inventory-summary"],
    ["POST", "/v1/stores/store-a/catalog"], ["PATCH", "/v1/stores/store-a/catalog/of-draft"],
  ]);
  assert.ok(calls.every(call => call.target.origin === dsh && call.options.headers.Authorization === "Bearer synthetic"));
  assert.deepEqual(JSON.parse(calls[2].options.body), create);
  assert.deepEqual(JSON.parse(calls[3].options.body), editChange);
});

test("Web catalog rejects valid-looking oversized read and write replies without admitting them", async t => {
  const transport = catalogTransport("web", () => assert.fail("native credential"));
  const signal = new AbortController().signal;
  let reply;
  t.mock.method(globalThis, "fetch", async () => reply);
  reply = new Response(JSON.stringify({ catalog }) + " ".repeat(262145), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  await assert.rejects(transport.readMerchantCatalogPage(testStore, testActor, signal), { code: "OWNER_RESPONSE_INVALID" });
  reply = new Response(JSON.stringify({ draft: newDraft }) + " ".repeat(65537), {
    status: 201, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  await assert.rejects(transport.submitMerchantCatalogDraft(testStore, testActor, create, signal), { code: "OPERATION_RESULT_UNKNOWN" });
  reply = noStore({ inventory: stockSummary });
  assert.deepEqual(await transport.readMerchantInventorySummary(testStore, testActor, signal), stockSummary);
});

test("shared Merchant Web transport discards untrusted receipts despite cleanup failure", async t => {
  const query = new URLSearchParams({ catalog: testStore });
  const invoke = (signal, method = "GET") => merchantOwnerWeb.requestMerchantOwnerDocument({
    query, actorId: testActor, method, signal,
  });
  let calls = 0;
  let cancellations = 0;
  let reply = new Response(new ReadableStream({
    cancel() { cancellations++; throw new Error("cleanup failed"); },
  }), { headers: { "Content-Type": "application/json" } });
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply; });
  await assert.rejects(invoke(AbortSignal.abort()), { code: "OWNER_RESPONSE_STALE" });
  assert.equal(calls, 0);
  await assert.rejects(invoke(new AbortController().signal, "PATCH"), { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(cancellations, 1);
  assert.equal(reply.body.locked, false);
  reply = noStore({ catalog });
  assert.deepEqual((await invoke(new AbortController().signal)).document, { catalog });
});

test("shared owner request settles on caller cancellation before headers and discards late replies", async t => {
  let resolveFetch;
  let cancelled = 0;
  const controller = new AbortController();
  const query = new URLSearchParams({ catalog: testStore });
  const invoke = (signal, method = "GET") => merchantOwnerWeb.requestMerchantOwnerDocument({
    query, actorId: testActor, method, signal,
  });
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => { resolveFetch = resolve; }));
  const operation = invoke(controller.signal).then(() => "accepted", error => error.code);
  controller.abort();
  let timer;
  const outcome = await Promise.race([operation, new Promise(resolve => { timer = setTimeout(() => resolve("stalled"), 80); })]);
  clearTimeout(timer);
  const reply = new Response(new ReadableStream({ cancel() { cancelled++; } }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  resolveFetch(reply);
  await operation;
  await new Promise(setImmediate);
  assert.equal(outcome, "OWNER_RESPONSE_STALE");
  assert.equal(cancelled, 1);
  assert.equal(reply.body.locked, false);
});

test("shared owner request deadline aborts stalled headers, preserves write uncertainty, and recovers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let receivedSignal;
  let rejectFetch;
  let calls = 0;
  const query = new URLSearchParams({ catalog: testStore });
  const invoke = (method = "GET") => merchantOwnerWeb.requestMerchantOwnerDocument({
    query, actorId: testActor, method, signal: new AbortController().signal,
  });
  t.mock.method(globalThis, "fetch", (_url, options) => {
    calls++;
    receivedSignal = options.signal;
    return new Promise((_resolve, reject) => { rejectFetch = reject; });
  });
  for (const [method, code] of [["GET", "OWNER_NETWORK_UNAVAILABLE"], ["PATCH", "OPERATION_RESULT_UNKNOWN"]]) {
    const outcome = invoke(method);
    const rejected = assert.rejects(outcome, { status: 0, code });
    t.mock.timers.tick(20000);
    await rejected;
    assert.equal(receivedSignal.aborted, true);
    rejectFetch(new Error("late network rejection"));
    await new Promise(setImmediate);
  }
  assert.equal(calls, 2, "never retry a possibly committed command");
  globalThis.fetch = async () => noStore({ catalog });
  assert.deepEqual((await invoke()).document, { catalog });
});

test("shared owner disposal tolerates synchronous adapter failure", async t => {
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200, ok: true, headers: new Headers(),
    body: { locked: false, cancel() { throw new Error("adapter cleanup failure"); } },
    bodyUsed: false,
  }));
  await assert.rejects(merchantOwnerWeb.requestMerchantOwnerDocument({
    query: new URLSearchParams({ catalog: testStore }), actorId: testActor,
    method: "GET", signal: new AbortController().signal,
  }), { code: "OWNER_RESPONSE_INVALID" });
});
