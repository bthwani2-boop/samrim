import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DshPublicError, getPublicStore, listPublicOffers, listPublicStores,
} from "../../services/dsh/clients/index.ts";

const base = "http://127.0.0.1:3202";
const store = Object.freeze({
  id: "market-sanaa", name: "متجر أ", cityId: "sanaa", verticalId: "grocery",
  orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
});
const offer = Object.freeze({
  id: "of-flour", storeId: store.id, name: "دقيق",
  variantId: "v-p-flour", priceYer: 1200, available: true,
});
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const rejectsAs = (request, status, code) =>
  assert.rejects(request, error => error instanceof DshPublicError &&
    error.status === status && error.code === code);

async function withFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("the DSH read client rejects missing, malformed, unsafe and credentialed endpoints", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json(store); }, async () => {
    await rejectsAs(() => getPublicStore("", store.id), 0, "DSH_ENDPOINT_NOT_CONFIGURED");
    await rejectsAs(() => getPublicStore("not a URL", store.id), 0, "DSH_ENDPOINT_INVALID");
    await rejectsAs(() => getPublicStore("http://public.example", store.id), 0, "DSH_ENDPOINT_UNSAFE");
    await rejectsAs(() => getPublicStore("https://user:secret@example.com", store.id), 0, "DSH_ENDPOINT_UNSAFE");
  });
  assert.equal(calls, 0, "unsafe endpoints must never reach the network");
});

test("published marketplace pages preserve scoped city, cursor, limit and allowlisted store shape", async () => {
  let requested;
  await withFetch(async (url, options) => {
    requested = { url: new URL(url), options };
    return json({ items: [store], nextCursor: "opaque-next", revision: 7 });
  }, async () => {
    const page = await listPublicStores(base, "sanaa", { cursor: "opaque-current", limit: 2 });
    assert.deepEqual(page, { items: [store], nextCursor: "opaque-next", revision: 7 });
  });
  assert.equal(requested.url.pathname, "/v1/public/stores");
  assert.equal(requested.url.searchParams.get("city_id"), "sanaa");
  assert.equal(requested.url.searchParams.get("cursor"), "opaque-current");
  assert.equal(requested.url.searchParams.get("limit"), "2");
  assert.equal(requested.options.headers.Accept, "application/json");
});

test("Store search is encoded as owner query text and preserves page scope", async () => {
  const query = "متجر & %_";
  await withFetch(async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("q"), query);
    assert.equal(parsed.searchParams.get("city_id"), "sanaa");
    assert.equal(parsed.searchParams.get("cursor"), "search-page");
    return json({ items: [store], revision: 7 });
  }, async () => {
    assert.deepEqual((await listPublicStores(base, "sanaa", { query, cursor: "search-page" })).items, [store]);
  });
});

test("Store search rejects invalid wire text before any network request", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json({ items: [], revision: 1 }); }, async () => {
    for (const query of ["a".repeat(81), " ".repeat(81), ` ${"a".repeat(80)}`, "a\u0000b", "\ud800"]) {
      await rejectsAs(() => listPublicStores(base, "sanaa", { query }), 400, "INVALID_SEARCH");
    }
  });
  assert.equal(calls, 0);
});

test("Store search accepts 80 Unicode code points without splitting surrogate pairs", async () => {
  const query = "😀".repeat(80);
  await withFetch(async (url) => {
    assert.equal(new URL(url).searchParams.get("q"), query);
    return json({ items: [], revision: 1 });
  }, () => listPublicStores(base, "sanaa", { query }));
});

test("DIRECT linked detail is read without claiming marketplace listing", async () => {
  await withFetch(async (url) => {
    assert.equal(new URL(url).pathname, "/v1/public/stores/direct-sanaa");
    return json({ ...store, id: "direct-sanaa" });
  }, async () => assert.equal((await getPublicStore(base, "direct-sanaa")).id, "direct-sanaa"));
});

test("owner 409 stale cursor and other explicit owner errors propagate safely", async () => {
  await withFetch(async () => json({ error: "STALE_CURSOR" }, 409),
    () => rejectsAs(() => listPublicStores(base, "sanaa", { cursor: "outdated" }), 409, "STALE_CURSOR"));
  await withFetch(async () => new Response("unparseable", { status: 503 }),
    () => rejectsAs(() => getPublicStore(base, store.id), 503, "OWNER_READ_FAILED"));
});

test("network errors are normalized, except an aborted caller's own error", async () => {
  await withFetch(async () => { throw new Error("private transport details"); },
    () => rejectsAs(() => getPublicStore(base, store.id), 0, "OWNER_NETWORK_UNAVAILABLE"));
  const controller = new AbortController();
  const aborted = new Error("caller cancelled");
  controller.abort();
  await withFetch(async () => { throw aborted; },
    () => assert.rejects(() => getPublicStore(base, store.id, controller.signal), error => error === aborted));
});

test("invalid owner JSON or an invalid page envelope fails closed", async () => {
  await withFetch(async () => new Response("not-json"),
    () => rejectsAs(() => getPublicStore(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
  for (const value of [
    null, [], { items: {}, revision: 1 },
    { items: [], revision: 1.5 },
    { items: [], revision: 2, nextCursor: { unsafe: true } },
    { items: [{ ...store, orderingAvailable: true }], revision: 1 },
    { items: [{ ...store, orderabilityStatus: "UNREVIEWED" }], revision: 1 },
  ]) {
    await withFetch(async () => json(value),
      () => rejectsAs(() => listPublicStores(base, "sanaa"), 502, "OWNER_RESPONSE_INVALID"));
  }
});

test("Offer reads preserve integer YER prices and reject drafts or forged availability", async () => {
  await withFetch(async (url) => {
    assert.equal(new URL(url).pathname, "/v1/public/stores/market-sanaa/offers");
    return json({ items: [offer], revision: 4 });
  }, async () => {
    const response = await listPublicOffers(base, store.id);
    assert.equal(response.items[0].priceYer, 1200);
  });
  for (const value of [
    { ...offer, priceYer: 0 }, { ...offer, priceYer: -1 },
    { ...offer, priceYer: 100.4 }, { ...offer, priceYer: Number.MAX_SAFE_INTEGER + 1 },
    { ...offer, available: false }, { ...offer, variantId: null },
  ]) {
    await withFetch(async () => json({ items: [value], revision: 1 }),
      () => rejectsAs(() => listPublicOffers(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
  }
});

test("a public Store response cannot cross the requested Store or city scope", async () => {
  await withFetch(async () => json({ ...store, id: "market-aden" }),
    () => rejectsAs(() => getPublicStore(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
  await withFetch(async () => json({ items: [{ ...store, cityId: "aden" }], revision: 1 }),
    () => rejectsAs(() => listPublicStores(base, "sanaa"), 502, "OWNER_RESPONSE_INVALID"));
});

test("an Offer page cannot inject another Store's Offers into the selected Store", async () => {
  await withFetch(async () => json({ items: [offer, { ...offer, id: "other-offer", storeId: "market-aden" }], revision: 1 }),
    () => rejectsAs(() => listPublicOffers(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
});

test("owner request carries the caller AbortSignal instead of starting an unrelated session", async () => {
  const controller = new AbortController();
  await withFetch(async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    return json(store);
  }, async () => {
    const result = await getPublicStore(base, store.id, controller.signal);
    assert.equal(result.id, store.id);
  });
});

test("public successful reads require JSON media type and bounded response size", async () => {
  for (const headers of [{ "Content-Type": "text/html" }, {}]) {
    await withFetch(async () => new Response(JSON.stringify(store), { status: 200, headers }),
      () => rejectsAs(() => getPublicStore(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
  }
  await withFetch(async () => new Response(JSON.stringify(store) + " ".repeat(70000), {
    status: 200, headers: { "Content-Type": "application/json" },
  }), () => rejectsAs(() => getPublicStore(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
  await withFetch(async () => new Response(JSON.stringify(store), {
    status: 200, headers: { "Content-Type": "application/json", "Content-Length": "70000" },
  }), () => rejectsAs(() => getPublicStore(base, store.id), 502, "OWNER_RESPONSE_INVALID"));
  await withFetch(async () => new Response(JSON.stringify(store), {
    status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
  }), async () => assert.equal((await getPublicStore(base, store.id)).id, store.id));
});

test("an owner response arriving after a context switch cannot revive a cancelled public read", async () => {
  const controller = new AbortController();
  await withFetch(async () => {
    controller.abort();
    return json(store);
  }, () => rejectsAs(() => getPublicStore(base, store.id, controller.signal), 0, "OWNER_RESPONSE_STALE"));
});
