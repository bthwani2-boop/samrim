import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "../app/v1/public/[...discovery]+api.ts";

const base = "http://localhost:18102/v1/public/stores/market-sanaa/offers";
function setup(t, reply = () => Response.json({
  items: [{ id: "offer-a", storeId: "market-sanaa", variantId: "variant-a",
    name: "ماء", available: true, priceYer: 150 }], revision: 2,
}, { headers: { "Cache-Control": "no-store" } })) {
  const prior = process.env.NODE_ENV;
  const priorOwner = process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN;
  process.env.NODE_ENV = "development";
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
    if (priorOwner === undefined) delete process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN;
    else process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN = priorOwner;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    return reply();
  });
  return calls;
}

test("Merchant Web reads only DSH public offers via local same-origin API", async t => {
  const calls = setup(t);
  const response = await GET(new Request(base + "?cursor=page-2&limit=1"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).items[0].name, "ماء");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url,
    "http://127.0.0.1:3202/v1/public/stores/market-sanaa/offers?cursor=page-2&limit=1");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("Merchant Web offer reader rejects private, malformed, cross-site and unbounded inputs", async t => {
  const calls = setup(t);
  for (const query of ["?actorId=other", "?cursor=a&cursor=b", "?cursor=../other",
    "?limit=51", "?limit=0", "?limit=-1", "?q=%ZZ", "?q=%FF",
    "?q=" + "a".repeat(4099)]) {
    assert.equal((await GET(new Request(base + query))).status, 400, query.slice(0, 80));
  }
  assert.equal((await GET(new Request(base, {
    headers: { Origin: "https://evil.test" },
  }))).status, 403);
  assert.equal((await GET(new Request(base, {
    headers: { "Sec-Fetch-Site": "cross-site" },
  }))).status, 403);
  assert.equal((await GET(new Request("http://localhost:18102/v1/public/stores/mine"))).status, 404);
  assert.equal(calls.length, 0);
});

test("Merchant public read fails closed outside isolated development and never returns invalid DSH results", async t => {
  let bad = true;
  const calls = setup(t, () => bad
    ? Response.json({ items: [{ id: "offer-a", storeId: "another-store",
        variantId: "variant-a", name: "not this Store", priceYer: 123,
        available: true }], revision: 1 }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "NOT_FOUND" }, { status: 404 }));
  assert.equal((await GET(new Request(base))).status, 503);
  bad = false;
  assert.equal((await GET(new Request(base))).status, 404);
  process.env.NODE_ENV = "production";
  assert.equal((await GET(new Request(base))).status, 404);
  assert.equal(calls.length, 2);
});

test("Merchant published-offers Web calls only the same-origin Expo owner proxy", () => {
  const code = readFileSync(new URL("../src/features/catalog/merchant-published-offers.tsx", import.meta.url), "utf8");
  assert.match(code, /Platform\.OS === "web"/);
  assert.match(code, /window\.location\.origin/);
  assert.match(code, /listPublicOffers\(origin/);
});
test("Merchant public Offer search forwards owner query and bounded pagination unchanged", async t => {
  const calls = setup(t);
  const q = encodeURIComponent("ماء");
  const response = await GET(new Request(`${base}?q=${q}&limit=2`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.length, 1);
  assert.equal(calls.length, 1);
  const dest = new URL(calls[0].url);
  assert.equal(dest.pathname, "/v1/public/stores/market-sanaa/offers");
  assert.equal(dest.searchParams.get("q"), "ماء");
  assert.equal(dest.searchParams.get("limit"), "2");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("Merchant public Store detail is read from DSH, without Merchant bearer or private grants", async t => {
  const publicStore = {
    id: "market-sanaa", name: "متجر صنعاء", cityId: "sanaa", verticalId: "grocery",
    orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
  };
  const calls = setup(t, () => Response.json(publicStore, {
    headers: { "Cache-Control": "no-store" },
  }));
  const reply = await GET(new Request("http://localhost:18102/v1/public/stores/market-sanaa"));
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await reply.json(), publicStore);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:3202/v1/public/stores/market-sanaa");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("Merchant public Store detail rejects private aliases, queries and cross-origin access without owner traffic", async t => {
  const calls = setup(t);
  const root = "http://localhost:18102/v1/public/stores/";
  for (const target of [
    "mine", "market-sanaa/availability", "market-sanaa/preview",
    "MARKET", "market%2Fsanaa", "market-sanaa?limit=1",
    "market-sanaa?actorId=other", "market-sanaa?cursor=old",
    "market-sanaa?utm_source=x",
  ]) {
    const reply = await GET(new Request(root + target));
    assert.ok([400, 404].includes(reply.status), target);
  }
  assert.equal((await GET(new Request(`${root}market-sanaa`, {
    headers: { Origin: "https://untrusted.example" },
  }))).status, 403);
  assert.equal(calls.length, 0);
});

test("Merchant public Store detail refuses malformed and unpublished DSH results", async t => {
  let answer = "wrong-id";
  const calls = setup(t, () => {
    if (answer === "missing") return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    const body = { id: answer === "wrong-id" ? "other-store" : "market-sanaa",
      name: "متجر", cityId: "sanaa", verticalId: "grocery",
      orderabilityStatus: "PAUSED", orderingAvailable: false,
      ...(answer === "private-fields" ? { ownerActorId: "private-actor" } : {}) };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  });
  const url = "http://localhost:18102/v1/public/stores/market-sanaa";
  assert.equal((await GET(new Request(url))).status, 503);
  answer = "private-fields";
  assert.equal((await GET(new Request(url))).status, 503);
  answer = "missing";
  assert.equal((await GET(new Request(url))).status, 404);
  assert.equal(calls.length, 3);
});

test("Merchant public discovery rejects malformed wire envelopes before normalization or owner access", async t => {
  const calls = setup(t);
  const root = "http://localhost:18102/v1/public/";
  for (const path of ["stores/market-sanaa?", "stores/market-sanaa/offers?q=water;flour"]) {
    const reply = await GET(new Request(root + path));
    assert.equal(reply.status, 400, path);
    assert.deepEqual(await reply.json(), { error: "INVALID_REQUEST" });
  }
  for (const path of ["stores/market-sanaa", "stores/market-sanaa/offers"]) {
    for (const headers of [{ "Content-Length": "2" }, { "Transfer-Encoding": "chunked" }]) {
      assert.equal((await GET(new Request(root + path, { headers }))).status, 400, path);
    }
  }
  for (const path of ["cities", "verticals?city_id=sanaa", "stores?city_id=sanaa", "stores/market-sanaa/offers/of-flour/estimate?quantity=1"]) {
    assert.equal((await GET(new Request(root + path))).status, 404, path);
  }
  assert.equal(calls.length, 0);
  assert.equal((await GET(new Request(root + "stores/market-sanaa/offers?q=water%3Bflour"))).status, 200);
  assert.equal(new URL(calls[0].url).searchParams.get("q"), "water;flour");
});

test("Merchant adapter preserves its narrow owner origin and error boundary", async t => {
  let failure = false;
  const calls = setup(t, () => failure
    ? Response.json({ error: "INSUFFICIENT_AVAILABLE_QUANTITY" }, { status: 409 })
    : Response.json({ items: [], revision: 2 }));
  delete process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN;
  assert.equal((await GET(new Request(base, { headers: { "Content-Length": "0" } }))).status, 200);
  assert.equal(new URL(calls[0].url).origin, "http://127.0.0.1:3202");
  const method = await GET(new Request(base, { method: "POST" }));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "GET");
  failure = true;
  assert.equal((await GET(new Request(base))).status, 503);
  assert.equal(calls.length, 2);
});

test("Public discovery preserves zero-byte framing and rejects an explicit empty query delimiter", async t => {
  const calls = setup(t);
  const url = "http://localhost:18102/v1/public/stores/market-sanaa/offers";
  for (const length of ["00", "000"]) {
    const reply = await GET(new Request(url, { headers: { "Content-Length": length } }));
    assert.equal(reply.status, 200, length);
  }
  for (const length of ["01", "0, 0", "-0", "0.0"]) {
    const reply = await GET(new Request(url, { headers: { "Content-Length": length } }));
    assert.equal(reply.status, 400, length);
  }
  const reply = await GET(new Request(url + "?"));
  assert.equal(reply.status, 400);
  assert.deepEqual(await reply.json(), { error: "INVALID_REQUEST" });
  assert.equal(calls.length, 2);
});
