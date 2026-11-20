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
