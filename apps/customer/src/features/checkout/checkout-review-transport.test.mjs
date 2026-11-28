import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as dsh from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { discardCustomerResponse, readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";

const root = path.resolve(import.meta.dirname, "../../../../..");
const source = path.join(import.meta.dirname, "checkout-review-transport.ts");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-checkout-transport-"));
let compiled;
try {
  const r = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--inlineSourceMap", "--inlineSources", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  compiled = readFileSync(path.join(temp, "checkout-review-transport.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

const actor = "synthetic-customer-a";
const store = "store-a";
const origin = "http://127.0.0.1:3202";
const bearer = Buffer.alloc(32, 14).toString("base64url");
const input = { expectedCartVersion: 4, salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP" };
const review = {
  actorId: actor, storeId: store, cartVersion: 4, salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP",
  merchandise: { actorId: actor, storeId: store, cartVersion: 4, lines: [
    { offerId: "offer-a", variantId: "variant-a", quantity: 2, unitYer: "550", lineTotalYer: "1100" }],
    merchandiseSubtotalYer: "1100", checkoutReady: false },
  storeSchedule: { status: "PAUSED", version: 3, pausedUntil: "2026-11-27T20:00:00.123456Z" }, checkoutReady: false,
  blockers: ["FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"],
};
const json = (body, status = 200, cache = "no-store") => Response.json(body, { status, headers: { "Cache-Control": cache } });
const signal = () => new AbortController().signal;
const retainedModules = [];

function harness(t, platform = "web", configured = true) {
  const requests = [], replies = [], verifications = [], nativeCalls = [];
  let nativeOutcome = "ready", verificationErrorAt = -1;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), ...init });
    assert.ok(replies.length, "unexpected request");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const key = "EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN";
  const previous = process.env[key];
  if (configured) process.env[key] = origin;
  else delete process.env[key];
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
  const module = loadMappedRenderFixture(compiled, source, {
    "@bthwani/dsh": dsh,
    "react-native": { Platform: { OS: platform } },
    "../access/bounded-customer-json": { discardCustomerResponse, readBoundedCustomerJSON },
    "../addresses/address-transport": {
      async verifyAddressSession(s, a) {
        verifications.push({ signal: s, actor: a });
        s.throwIfAborted();
        if (verifications.length === verificationErrorAt) throw new dsh.DshPublicError(401, "UNAUTHORIZED");
        return { actorId: actor, role: "customer", sessionExpiresAt: "2030-01-01T00:00:00Z" };
      },
    },
    "../access/customer-session-transport": {
      async withVerifiedNativeCustomerRead(s, read, a) {
        nativeCalls.push({ signal: s, actor: a });
        if (nativeOutcome !== "ready") return { kind: nativeOutcome };
        return { kind: "ready", value: await read(bearer), expiresAt: Date.now() + 60000 };
      },
    },
  });
  retainedModules.push(module);
  return { requests, replies, verifications, nativeCalls,
    denyAt(n) { verificationErrorAt = n; },
    native(kind) { nativeOutcome = kind; },
    read(s = signal()) { return module.exports.readCheckoutReview(actor, store, input, s); },
  };
}

test("Web checkout accepts only the exact owner review with current actor before and after", async t => {
  const h = harness(t);
  const s = signal();
  h.replies.push(json(review));
  assert.deepEqual(await h.read(s), { kind: "ready", review });
  assert.deepEqual(h.verifications, [{ signal: s, actor }, { signal: s, actor }]);
  assert.equal(h.requests.length, 1);
  const req = h.requests[0];
  assert.equal(req.url, "/api/customer-auth/checkout-review?storeId=store-a");
  assert.equal(req.method, "POST");
  assert.equal(req.credentials, "same-origin");
  assert.equal(req.redirect, "error");
  assert.equal(req.cache, "no-store");
  assert.equal(req.signal, s);
  assert.equal(req.headers["X-Customer-Context"], actor);
  assert.deepEqual(JSON.parse(req.body), input);
});

test("Web checkout rejects wrong response MIME or declared/actual oversized JSON", async t => {
  const h = harness(t);
  const body = JSON.stringify(review);
  h.replies.push(
    new Response(body, { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } }),
    new Response(body, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json", "Content-Length": "32769" } }),
    new Response(body + " ".repeat(32768), { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } }),
  );
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await h.read());
  assert.deepEqual(results, Array.from({ length: 3 }, () => ({ kind: "unavailable" })));
  h.replies.push(json(review));
  assert.deepEqual(await h.read(), { kind: "ready", review });
});

test("Web checkout cancels rejected response bodies without exposing them", async t => {
  const h = harness(t);
  const cancelled = [];
  for (const [status, cache] of [[401, "no-store"], [403, "no-store"], [503, "no-store"], [200, "public"]]) {
    h.replies.push(new Response(new ReadableStream({ cancel() { cancelled.push(status); } }),
      { status, headers: { "Cache-Control": cache } }));
  }
  assert.deepEqual(await h.read(), { kind: "signed-out" });
  assert.deepEqual(await h.read(), { kind: "signed-out" });
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  assert.deepEqual(cancelled, [401, 403, 503, 200]);
});

test("Web checkout aborts a stalled body even when fetch ignores cancellation and permits a successor", async t => {
  const h = harness(t);
  const controller = new AbortController();
  let streamController, cancelled = false;
  const body = new ReadableStream({
    start(c) { streamController = c; c.enqueue(new TextEncoder().encode("{")); },
    cancel() { cancelled = true; },
  });
  h.replies.push(new Response(body, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } }));
  const pending = h.read(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  let timer;
  try {
    assert.deepEqual(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STILL_PENDING"), 250); })]),
      { kind: "unavailable" });
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timer);
    if (!cancelled) streamController.close();
    await pending;
  }
  h.replies.push(json(review));
  assert.deepEqual(await h.read(), { kind: "ready", review });
});

test("Web checkout releases a stalled body at the shared read deadline without caller abort", async t => {
  const h = harness(t);
  let streamController, cancelled = false;
  const body = new ReadableStream({
    start(c) { streamController = c; c.enqueue(new TextEncoder().encode("{")); },
    cancel() { cancelled = true; },
  });
  h.replies.push(new Response(body, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } }));
  const pending = h.read();
  let timer;
  try {
    assert.deepEqual(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STILL_PENDING"), 3000); })]),
      { kind: "unavailable" });
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timer);
    if (!cancelled) streamController.close();
    await pending;
  }
});

test("Web checkout refuses stale actor, malformed result, payable state and pre-aborted requests", async t => {
  const h = harness(t);
  h.replies.push(json({ ...review, actorId: "other-customer" }), json({ ...review, checkoutReady: true }), json(review));
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  h.denyAt(h.verifications.length + 2);
  assert.deepEqual(await h.read(), { kind: "signed-out" });
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await h.read(aborted.signal), { kind: "unavailable" });
  assert.equal(h.requests.length, 3);
});

test("Android checkout uses the real DSH client in the verified Native boundary and denies lost scope", async t => {
  const h = harness(t, "android");
  const s = signal();
  h.replies.push(json(review));
  assert.deepEqual(await h.read(s), { kind: "ready", review });
  assert.deepEqual(h.nativeCalls, [{ signal: s, actor }]);
  assert.equal(h.requests[0].url, `${origin}/v1/carts/store-a/checkout-review`);
  assert.equal(h.requests[0].headers.Authorization, `Bearer ${bearer}`);
  assert.equal(h.requests[0].credentials, "omit");
  assert.deepEqual(JSON.parse(h.requests[0].body), input);
  h.native("signed-out");
  assert.deepEqual(await h.read(), { kind: "signed-out" });
  h.native("unavailable");
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  assert.equal(h.requests.length, 1);
});

test("Android checkout fails closed without its owner origin", async t => {
  const h = harness(t, "android", false);
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  assert.equal(h.nativeCalls.length, 0);
  assert.equal(h.requests.length, 0);
});

test("pre-aborted checkout dispatches neither admission nor DSH", async t => {
  const h = harness(t);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await h.read(controller.signal), { kind: "unavailable" });
  assert.equal(h.verifications.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.nativeCalls.length, 0);
});

test("cancelled checkout settles while headers are stalled and disposes the late reply", async t => {
  const h = harness(t);
  const controller = new AbortController();
  let release, cancelled = 0, timer;
  const held = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, "fetch", () => held);
  const pending = h.read(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  try {
    assert.deepEqual(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 250); })]),
      { kind: "unavailable" });
  } finally {
    clearTimeout(timer);
    release(new Response(new ReadableStream({ cancel() { cancelled++; } }), {
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    }));
    await pending;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(cancelled, 1);
  assert.equal(h.verifications.length, 1);
  t.mock.method(globalThis, "fetch", async () => json(review));
  assert.deepEqual(await h.read(), { kind: "ready", review });
});

test("checkout binds a single immutable request to dispatch and response admission", async t => {
  const h = harness(t);
  const original = input.expectedCartVersion;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(JSON.parse(init.body).expectedCartVersion, original);
    input.expectedCartVersion = original + 1;
    return json(review);
  });
  try {
    assert.deepEqual(await h.read(), { kind: "ready", review });
  } finally {
    input.expectedCartVersion = original;
  }
});

test("invalid review input and unsupported surfaces dispatch nothing", async t => {
  const h = harness(t, "ios");
  assert.deepEqual(await h.read(), { kind: "unavailable" });
  const version = input.expectedCartVersion;
  try {
    input.expectedCartVersion = 0;
    assert.deepEqual(await h.read(), { kind: "unavailable" });
  } finally { input.expectedCartVersion = version; }
  assert.equal(h.verifications.length, 0);
  assert.equal(h.nativeCalls.length, 0);
  assert.equal(h.requests.length, 0);
});

test("rejected checkout envelopes remain unavailable even if cleanup fails", async t => {
  const h = harness(t);
  h.replies.push(
    { status: 503, get body() { throw new Error("body inaccessible"); } },
    new Response(null, { status: 503 }),
    { status: 503, body: { locked: true }, bodyUsed: false },
    { status: 503, body: { locked: false }, bodyUsed: true },
    new Response(new ReadableStream({ cancel() { return Promise.reject(new Error("cleanup failed")); } }), { status: 503 }),
    new Error("network error"),
  );
  for (let i = 0; i < 6; i++) assert.deepEqual(await h.read(), { kind: "unavailable" });
  h.replies.push(json(review));
  assert.deepEqual(await h.read(), { kind: "ready", review });
});

test("Android cancellation does not admit an obsolete owner response", async t => {
  const h = harness(t, "android");
  const controller = new AbortController();
  let release, timer;
  const held = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, "fetch", () => held);
  const pending = h.read(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  try {
    assert.deepEqual(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 250); })]),
      { kind: "unavailable" });
  } finally {
    clearTimeout(timer);
    release(json(review));
    await pending;
  }
  t.mock.method(globalThis, "fetch", async () => json(review));
  assert.deepEqual(await h.read(), { kind: "ready", review });
});
