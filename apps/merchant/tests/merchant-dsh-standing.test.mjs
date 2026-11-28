import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { readMerchantDSHStanding } from "@bthwani/dsh";

const bearer = Buffer.alloc(32, 7).toString("base64url");
const origin = "https://dsh.test";
const owner = {
  actorId: "merchant-one",
  stores: [{ id: "store-a", name: "A Store", relation: "MARKETPLACE", published: false }],
};
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (value, status = 200) => Response.json(value, { status, headers });
const invalid = { code: "OWNER_RESPONSE_INVALID" };

test("Merchant standing uses the authenticated owner endpoint without cookies", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/stores/mine");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.credentials, "omit");
    return reply(owner);
  });
  assert.deepEqual(await readMerchantDSHStanding(origin, bearer), owner);
});

test("Merchant standing rejects malformed owner records and duplicate Store IDs", async t => {
  for (const value of [
    { ...owner, stores: [{ ...owner.stores[0], published: "yes" }] },
    { ...owner, stores: [owner.stores[0], owner.stores[0]] },
  ]) {
    t.mock.method(globalThis, "fetch", async () => reply(value));
    await assert.rejects(readMerchantDSHStanding(origin, bearer), invalid);
    t.mock.restoreAll();
  }
});

test("Owner denial and outage fail closed", async t => {
  for (const [status, code] of [[403, "STORE_ACCESS_DENIED"], [503, "OWNER_UNAVAILABLE"]]) {
    t.mock.method(globalThis, "fetch", async () => reply({ code }, status));
    await assert.rejects(readMerchantDSHStanding(origin, bearer), { code });
    t.mock.restoreAll();
  }
});

test("Untrusted endpoint and malformed bearer cannot trigger owner fetch", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply(owner); });
  await assert.rejects(readMerchantDSHStanding("http://evil.example", bearer), { code: "OWNER_UNAVAILABLE" });
  await assert.rejects(readMerchantDSHStanding(origin, "not-a-bearer"), { code: "UNAUTHENTICATED" });
  assert.equal(calls, 0);
});

test("Aborted response cannot revive a previous account's standing", async t => {
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async () => { abort.abort(); return reply(owner); });
  await assert.rejects(readMerchantDSHStanding(origin, bearer, abort.signal), { code: "OWNER_RESPONSE_STALE" });
});

test("Merchant accepts a valid maximum Unicode Store listing", async t => {
  const stores = Array.from({ length: 100 }, (_, i) => ({
    id: "store-" + i,
    name: "😀".repeat(120),
    relation: "MARKETPLACE",
    published: i % 2 === 0,
  }));
  const encoded = JSON.stringify({ actorId: "x".repeat(128), stores }).replaceAll("😀", String.raw`\ud83d\ude00`);
  assert.ok(encoded.length > 32768);
  t.mock.method(globalThis, "fetch", async () => new Response(encoded, { headers }));
  assert.equal((await readMerchantDSHStanding(origin, bearer)).stores.length, 100);
});

test("Merchant rejects oversized and invalid UTF-8 owner bodies", async t => {
  for (const body of [" ".repeat(262145), new Uint8Array([0xff, 0xfe])]) {
    t.mock.method(globalThis, "fetch", async () => new Response(body, { headers }));
    await assert.rejects(readMerchantDSHStanding(origin, bearer), invalid);
    t.mock.restoreAll();
  }
});

test("Merchant cancels oversized streamed owner replies before draining them", async t => {
  let sent = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      sent++;
      controller.enqueue(new Uint8Array(65536).fill(32));
      if (sent === 10) controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, { headers }));
  await assert.rejects(readMerchantDSHStanding(origin, bearer), invalid);
  assert.ok(cancelled);
  assert.ok(sent <= 5);
  assert.equal(stream.locked, false);
});

test("Merchant refuses text-only bridges before consuming their owner reply", async t => {
  for (const length of [undefined, "262145"]) {
    let consumed = false;
    const responseHeaders = new Headers(headers);
    if (length !== undefined) responseHeaders.set("Content-Length", length);
    t.mock.method(globalThis, "fetch", async () => ({
      status: 200, ok: true, body: null, headers: responseHeaders,
      async text() { consumed = true; return JSON.stringify(owner); },
    }));
    await assert.rejects(readMerchantDSHStanding("http://10.0.2.2:8080", bearer), invalid);
    assert.equal(consumed, false);
    t.mock.restoreAll();
  }
});

test("Merchant uses streaming Android emulator origin without a global TextEncoder", async t => {
  const response = reply(owner);
  t.mock.method(globalThis, "fetch", async () => response);
  const saved = globalThis.TextEncoder;
  try {
    globalThis.TextEncoder = undefined;
    assert.deepEqual(await readMerchantDSHStanding("http://10.0.2.2:8080", bearer), owner);
  } finally {
    globalThis.TextEncoder = saved;
  }
});

test("Merchant cancels an abandoned response over actual local HTTP", { timeout: 10000 }, async t => {
  const server = createServer((request, response) => {
    assert.equal(request.url, "/v1/stores/mine");
    assert.equal(request.headers.authorization, "Bearer " + bearer);
    response.writeHead(200, headers);
    response.write('{"actorId":');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const abort = new AbortController();
  // Synchronize on actual response headers rather than elapsed wall-clock time.
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (...args) => {
    const response = await nativeFetch(...args);
    setImmediate(() => abort.abort());
    return response;
  });
  try {
    await assert.rejects(readMerchantDSHStanding(
      "http://127.0.0.1:" + server.address().port, bearer, abort.signal,
    ), { code: "OWNER_RESPONSE_STALE" });
  } finally {

    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
