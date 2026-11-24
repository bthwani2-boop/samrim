import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, PATCH, POST } from "../app/api/admission+api.ts";

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
function ownerMocks(t, { role = "merchant", ownerStatus = 200, ownerPage = catalog, draft = false, edit = false, expectedSearch = "?limit=20", inventory = false } = {}) {
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
