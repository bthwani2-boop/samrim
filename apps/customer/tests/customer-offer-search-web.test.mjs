import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/v1/public/[...discovery]+api.ts";

const page = { items: [], revision: 2 };
function setup(t, reply = () => Response.json(page)) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return reply();
  });
  return calls;
}
const request = (query) => new Request(`http://localhost:18101/v1/public/stores/market-sanaa/offers${query}`);

test("Offer estimate BFF accepts only a canonical quantity and relays current owner outcomes", async t => {
  const estimate = { storeId: "market-sanaa", offerId: "of-flour", variantId: "v-p-flour",
    quantity: 2, unitYer: "1200", subtotalYer: "2400" };
  let unavailable = false;
  const calls = setup(t, () => unavailable
    ? Response.json({ error: "INSUFFICIENT_AVAILABLE_QUANTITY" }, { status: 409 })
    : Response.json(estimate, { headers: { "Cache-Control": "no-store" } }));
  for (const invalid of ["", "?quantity=0", "?quantity=02", "?quantity=2&unitYer=1", "?quantity=2&quantity=3"]) {
    assert.equal((await GET(request(`/of-flour/estimate${invalid}`))).status, 400);
  }
  assert.equal(calls.length, 0);
  const scope = "/of-flour/estimate?quantity=2";
  const response = await GET(request(scope));
  assert.deepEqual(await response.json(), estimate);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls[0].url.href, `http://127.0.0.1:3202/v1/public/stores/market-sanaa/offers${scope}`);
  unavailable = true;
  const denied = await GET(request(scope));
  assert.equal(denied.status, 409);
  assert.deepEqual(await denied.json(), { error: "INSUFFICIENT_AVAILABLE_QUANTITY" });
});

test("Customer receives only current public city IDs through the same-origin BFF", async t => {
  const directory = { items: ["sanaa"], revision: 7, nextCursor: "page-three" };
  let body = directory;
  const calls = setup(t, () => Response.json(body));
  const response = await GET(new Request("http://localhost:18101/v1/public/cities?limit=1&cursor=page-two"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), directory);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls[0].url.pathname, "/v1/public/cities");
  assert.equal(calls[0].url.searchParams.get("cursor"), "page-two");
  for (const query of ["?city_id=sanaa", "?cursor=", "?limit=51", "?limit=1&limit=2"]) {
    assert.equal((await GET(new Request(`http://localhost:18101/v1/public/cities${query}`))).status, 400);
  }
  assert.equal(calls.length, 1);
  for (const invalid of [
    { items: ["sanaa", "sanaa"], revision: 7 },
    { items: ["sanaa"], revision: 7, nextCursor: "page-two" },
    { items: [{ id: "sanaa" }], revision: 7 },
  ]) {
    body = invalid;
    assert.equal((await GET(new Request("http://localhost:18101/v1/public/cities?cursor=page-two"))).status, 503);
  }
});

test("Customer public vertical directory BFF forwards only bounded city and cursor", async t => {
  const data = { items: [{ id: "grocery", storeCount: 2 }], revision: 4 };
  const calls = setup(t, () => Response.json(data));
  const result = await GET(new Request("http://localhost:18101/v1/public/verticals?city_id=sanaa&limit=1&cursor=next"));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), data);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/v1/public/verticals");
  assert.equal(calls[0].url.searchParams.get("city_id"), "sanaa");
  assert.equal(calls[0].url.searchParams.get("cursor"), "next");
});

test("Customer vertical directory rejects duplicate and unauthorised query fields before DSH", async t => {
  const calls = setup(t);
  for (const uri of [
    "verticals", "verticals?city_id=../sanaa", "verticals?city_id=sanaa&q=private",
    "verticals?city_id=sanaa&vertical_id=grocery",
    "verticals?city_id=sanaa&city_id=aden",
    "verticals?city_id=sanaa&limit=51",
  ]) {
    assert.equal((await GET(new Request(`http://localhost:18101/v1/public/${uri}`))).status, 400, uri);
  }
  assert.equal(calls.length, 0);
});

test("Customer Store BFF forwards the selected vertical to DSH without losing city and cursor", async t => {
  const calls = setup(t);
  const response = await GET(new Request("http://localhost:18101/v1/public/stores?city_id=sanaa&vertical_id=grocery&cursor=page-two&limit=2"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), page);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/v1/public/stores");
  assert.equal(calls[0].url.searchParams.get("city_id"), "sanaa");
  assert.equal(calls[0].url.searchParams.get("vertical_id"), "grocery");
  assert.equal(calls[0].url.searchParams.get("cursor"), "page-two");
});

test("Customer Store BFF rejects invalid, duplicate and cross-route vertical filters before owner access", async t => {
  const calls = setup(t);
  for (const uri of [
    "stores?city_id=sanaa&vertical_id=../private",
    "stores?city_id=sanaa&vertical_id=",
    "stores?city_id=sanaa&vertical_id=grocery&vertical_id=pharmacy",
    "stores?city_id=sanaa&vertical_id=PHARMACY",
    "stores/market-sanaa/offers?vertical_id=grocery",
  ]) {
    const response = await GET(new Request(`http://localhost:18101/v1/public/${uri}`));
    assert.equal(response.status, 400, uri);
  }
  assert.equal(calls.length, 0);
});

test("Customer Offers BFF forwards literal text, fixed Store scope and pagination through the owner client", async t => {
  const calls = setup(t);
  const query = "دقيق %_ &";
  const response = await GET(request(`?q=${encodeURIComponent(query)}&limit=2&cursor=page-two`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), page);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "http://127.0.0.1:3202");
  assert.equal(calls[0].url.pathname, "/v1/public/stores/market-sanaa/offers");
  assert.equal(calls[0].url.searchParams.get("q"), query);
  assert.equal(calls[0].url.searchParams.get("cursor"), "page-two");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
});

test("Offers BFF rejects duplicate, malformed, oversized and private query inputs before owner access", async t => {
  const calls = setup(t);
  for (const query of ["?q=a&q=b", "?q=%FF", "?q=%ZZ", "?q=%00", `?q=${"a".repeat(81)}`,
    `?q=+${"a".repeat(80)}`, "?q=a&actorId=private", "?q=a&origin=https://evil.test"]) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
  assert.equal(calls.length, 0);
});

test("Offers BFF preserves owner publication denial and stale search cursor recovery", async t => {
  let failure = { status: 404, error: "NOT_FOUND" };
  setup(t, () => Response.json({ error: failure.error }, { status: failure.status }));
  for (const item of [{ status: 404, error: "NOT_FOUND" }, { status: 409, error: "STALE_CURSOR" },
    { status: 400, error: "INVALID_CURSOR" }]) {
    failure = item;
    const response = await GET(request("?q=flour&cursor=old-page"));
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { error: item.error });
  }
});

test("Customer public discovery rejects malformed wire envelopes before normalization or owner access", async t => {
  const calls = setup(t);
  const root = "http://localhost:18101/v1/public/";
  for (const path of ["stores/market-sanaa?", "stores/market-sanaa/offers?q=water;flour", "cities?limit=1;cursor=x"]) {
    const reply = await GET(new Request(root + path));
    assert.equal(reply.status, 400, path);
    assert.deepEqual(await reply.json(), { error: "INVALID_REQUEST" });
  }
  for (const path of ["cities", "verticals?city_id=sanaa", "stores?city_id=sanaa", "stores/market-sanaa", "stores/market-sanaa/offers", "stores/market-sanaa/offers/of-flour/estimate?quantity=1"]) {
    for (const headers of [{ "Content-Length": "2" }, { "Transfer-Encoding": "chunked" }]) {
      assert.equal((await GET(new Request(root + path, { headers }))).status, 400, path);
    }
  }
  assert.equal(calls.length, 0);
  assert.equal((await GET(new Request(root + "stores/market-sanaa/offers?q=water%3Bflour"))).status, 200);
  assert.equal(calls[0].url.searchParams.get("q"), "water;flour");
});
