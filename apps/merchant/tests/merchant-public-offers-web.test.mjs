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