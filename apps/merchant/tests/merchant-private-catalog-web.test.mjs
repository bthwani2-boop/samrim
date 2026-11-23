import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/admission+api.ts";

const origin = "http://127.0.0.1:13310";
const dsh = "http://127.0.0.1:13311";
const bearer = Buffer.alloc(32, 12).toString("base64url");
const offer = {
  id: "of-draft", storeId: "store-a", productId: "product-a",
  name: "مسودة متجر", variantId: "variant-a", priceYer: "1200",
  stockUnits: 0, productActive: false, variantSellable: false,
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
function ownerMocks(t, { role = "merchant", ownerStatus = 200, ownerPage = catalog } = {}) {
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
    assert.equal(target.pathname, "/v1/stores/store-a/catalog");
    assert.equal(target.search, "?limit=20");
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
