import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as dsh from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";
import * as cartSession from "./cart-session.ts";

const source = path.join(import.meta.dirname, "cart-transport.ts");
const root = path.resolve(import.meta.dirname, "../../../../..");
const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-cart-transport-"));
let compiled;
try {
  const r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--inlineSourceMap", "--inlineSources", "--outDir", tmp], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  compiled = readFileSync(path.join(tmp, "cart-transport.js"), "utf8");
} finally { rmSync(tmp, { recursive: true, force: true }); }

const retained = [];
const actor = "synthetic-cart-actor";
const store = "store-a";
const cart = { actorId: actor, storeId: store, version: 2, lines: [
  { offerId: "offer-a", variantId: "variant-a", name: "Synthetic", quantity: 2, previewUnitYer: "550", previewAvailable: true },
] };
const estimate = { actorId: actor, storeId: store, cartVersion: 2, lines: [
  { offerId: "offer-a", variantId: "variant-a", quantity: 2, unitYer: "550", lineTotalYer: "1100" },
], merchandiseSubtotalYer: "1100", checkoutReady: false };
const signal = () => new AbortController().signal;
const json = (v, status = 200, cache = "no-store") => Response.json(v, { status, headers: { "Cache-Control": cache } });
const failure = (status, code) => e => e instanceof dsh.DshCartError && e.status === status && e.code === code;

function harness(t, os = "web", configured = true) {
  let nativeMode = "ready";
  const replies = [], requests = [], admissions = [], native = [];
  const admission = { enabled: true, session: { actorId: actor, role: "customer", sessionExpiresAt: "2030-01-01T00:00:00Z" } };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), ...init });
    assert.ok(replies.length, "unexpected request");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const previous = globalThis.window;
  const origin = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
  globalThis.window = { location: { origin: "http://localhost" } };
  if (configured) process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";
  else delete process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
  t.after(() => {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    if (origin === undefined) delete process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
    else process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN = origin;
  });
  const mod = loadMappedRenderFixture(compiled, source, {
    "@bthwani/dsh": dsh,
    "react-native": { Platform: { OS: os } },
    "../access/bounded-customer-json": { readBoundedCustomerJSON },
    "../access/customer-session-transport": {
      async readCustomerAdmission() { return admissions.shift() ?? admission; },
      async withVerifiedNativeCustomerRead(s, read, a) {
        native.push({ signal: s, actor: a });
        if (nativeMode === "signed-out") return { kind: "signed-out" };
        const value = await read(Buffer.alloc(32, 14).toString("base64url"));
        if (nativeMode === "late-error") throw new Error("lost native admission");
        return nativeMode === "late-signout" ? { kind: "signed-out" } : { kind: "ready", value };
      },
    },
    "./cart-session": cartSession,
  });
  retained.push(mod);
  return { api: mod.exports, requests, replies, admissions, native, admission, setNative(mode) { nativeMode = mode; } };
}

test("Cart and estimate retain exact owner scope and advisory amount", async t => {
  const h = harness(t);
  h.replies.push(json(cart), json(estimate));
  assert.deepEqual(await h.api.readVerifiedCart(store, signal()), { kind: "ready", cart });
  assert.deepEqual(await h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), { kind: "ready", estimate });
  assert.equal(h.requests[0].url, "/api/customer-auth/cart?storeId=store-a");
  assert.equal(h.requests[1].url, "/api/customer-auth/cart-estimate?storeId=store-a&expectedVersion=2");
  assert.ok(h.requests.every(r => r.method === "GET" && r.cache === "no-store" && r.credentials === "same-origin" && r.redirect === "error"));
  h.replies.push(json({ ...cart, actorId: "other" }), json({ ...estimate, checkoutReady: true }));
  await assert.rejects(h.api.readVerifiedCart(store, signal()), failure(502, "OWNER_RESPONSE_INVALID"));
  await assert.rejects(h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), failure(502, "OWNER_RESPONSE_INVALID"));
});

test("Cart and estimate reject malformed MIME, excessive size, and cancel rejected streams", async t => {
  const h = harness(t);
  const operations = [
    [cart, () => h.api.readVerifiedCart(store, signal())],
    [estimate, () => h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal())],
  ];
  for (const [body, read] of operations) {
    for (const response of [
      new Response(JSON.stringify(body), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } }),
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Content-Length": "65537", "Cache-Control": "no-store" } }),
      new Response(JSON.stringify(body) + " ".repeat(65537), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }),
    ]) {
      h.replies.push(response);
      await assert.rejects(read(), failure(502, "OWNER_RESPONSE_INVALID"));
    }
    let cancelled = false;
    h.replies.push(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 401 }));
    assert.deepEqual(await read(), { kind: "signed-out" });
    assert.equal(cancelled, true);
  }
});

test("Cart write with cacheable receipt stays pending and recovers only the same operation", async t => {
  const h = harness(t);
  const change = { operationId: "synthetic-cart-operation-one", expectedVersion: 1, lines: [{ offerId: "offer-a", quantity: 2 }] };
  const receipt = { cart, replay: false };
  h.replies.push(json(receipt, 200, "public"));
  await assert.rejects(h.api.replaceVerifiedCart(store, change, actor, signal()), failure(502, "OPERATION_RESULT_UNKNOWN"));
  assert.deepEqual(cartSession.pendingCartChange(actor, store), change);
  await assert.rejects(h.api.replaceVerifiedCart(store, { ...change, operationId: "synthetic-cart-operation-two" }, actor, signal()), failure(409, "CART_PENDING_RECONCILIATION"));
  assert.equal(h.requests.length, 1);
  h.replies.push(json({ cart, replay: true }));
  assert.deepEqual(await h.api.replaceVerifiedCart(store, change, actor, signal()), { cart, replay: true });
  assert.equal(cartSession.pendingCartChange(actor, store), undefined);
  assert.deepEqual(h.requests.map(r => JSON.parse(r.body)), [change, change]);
});

test("Aborting a stalled cart write releases its body and keeps the original pending operation", async t => {
  const h = harness(t);
  const otherStore = "store-b";
  const change = { operationId: "synthetic-cart-stalled", expectedVersion: 1, lines: [] };
  const ctl = new AbortController();
  let stream, cancelled = false, timer;
  h.replies.push(new Response(new ReadableStream({
    start(c) { stream = c; },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
  const pending = h.api.replaceVerifiedCart(otherStore, change, actor, ctl.signal)
    .then(() => "SUCCESS", e => e.code);
  try {
    await new Promise(resolve => setImmediate(resolve));
    ctl.abort();
    assert.equal(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 500); })]), "OPERATION_RESULT_UNKNOWN");
    assert.equal(cancelled, true);
    assert.deepEqual(cartSession.pendingCartChange(actor, otherStore), change);
  } finally {
    clearTimeout(timer);
    if (!cancelled) stream.close();
    await pending;
  }
  h.replies.push(json({ cart: { ...cart, storeId: otherStore }, replay: true }));
  assert.equal((await h.api.replaceVerifiedCart(otherStore, change, actor, signal())).replay, true);
  assert.equal(cartSession.pendingCartChange(actor, otherStore), undefined);
});

test("Cart read denies invalid scope and preserves network, status and identity failures", async t => {
  const h = harness(t);
  await assert.rejects(h.api.readVerifiedCart("../store", signal()), failure(400, "INVALID_REQUEST"));
  await assert.rejects(h.api.readVerifiedCartMerchandiseEstimate(store, -1, actor, signal()), failure(400, "INVALID_REQUEST"));
  h.admissions.push({ enabled: false });
  assert.deepEqual(await h.api.readVerifiedCart(store, signal()), { kind: "unavailable" });
  h.admissions.push({ enabled: true, session: null });
  assert.deepEqual(await h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), { kind: "signed-out" });
  assert.deepEqual(await h.api.readVerifiedCartMerchandiseEstimate(store, 2, "other", signal()), { kind: "signed-out" });
  assert.equal(h.requests.length, 0);
  h.replies.push(new Error("offline"), json(cart, 200, "public"), new Error("offline"), json(estimate, 409));
  await assert.rejects(h.api.readVerifiedCart(store, signal()), failure(503, "OWNER_NETWORK_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedCart(store, signal()), failure(503, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), failure(503, "OWNER_NETWORK_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), failure(409, "ESTIMATE_NOT_AVAILABLE"));
  const other = { ...h.admission, session: { ...h.admission.session, actorId: "other" } };
  h.admissions.push(h.admission, other, h.admission, other);
  h.replies.push(json(cart), json(estimate));
  assert.deepEqual(await h.api.readVerifiedCart(store, signal()), { kind: "signed-out" });
  assert.deepEqual(await h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), { kind: "signed-out" });
});

test("Cart mutations preserve definitive rejection and never confirm malformed or lost receipt", async t => {
  const h = harness(t);
  const change = { operationId: "synthetic-cart-status", expectedVersion: 1, lines: [] };
  const send = () => h.api.replaceVerifiedCart(store, change, actor, signal());
  await assert.rejects(h.api.replaceVerifiedCart(store, change, "other", signal()), failure(401, "UNAUTHORIZED"));
  assert.equal(h.requests.length, 0);
  for (const [status, code] of [[400, "INVALID_REQUEST"], [404, "STORE_OR_OFFER_NOT_AVAILABLE"], [409, "CART_VERSION_OR_OPERATION_CONFLICT"]]) {
    h.replies.push(json({}, status));
    await assert.rejects(send(), failure(status, code));
    assert.equal(cartSession.pendingCartChange(actor, store), undefined);
  }
  for (const [response, status, code] of [
    [new Error("offline"), 0, "OPERATION_RESULT_UNKNOWN"],
    [json({}, 403), 403, "UNAUTHORIZED"],
    [json({}, 503), 503, "OPERATION_RESULT_UNKNOWN"],
    [json({ cart: { ...cart, actorId: "other" }, replay: false }), 502, "OPERATION_RESULT_UNKNOWN"],
  ]) {
    h.replies.push(response);
    await assert.rejects(send(), failure(status, code));
    assert.deepEqual(cartSession.pendingCartChange(actor, store), change);
  }
  h.admissions.push(h.admission, { enabled: false });
  h.replies.push(json({ cart, replay: true }));
  await assert.rejects(send(), failure(0, "OPERATION_RESULT_UNKNOWN"));
  h.replies.push(json({ cart, replay: true }));
  assert.equal((await send()).replay, true);
  assert.equal(cartSession.pendingCartChange(actor, store), undefined);
});

test("Native cart write keeps same pending operation across lost verification", async t => {
  const h = harness(t, "android");
  const change = { operationId: "synthetic-native-cart", expectedVersion: 1, lines: [] };
  const send = () => h.api.replaceVerifiedCart(store, change, actor, signal());
  h.setNative("signed-out");
  await assert.rejects(send(), failure(401, "UNAUTHORIZED"));
  assert.equal(h.requests.length, 0);
  for (const mode of ["late-error", "late-signout"]) {
    h.setNative(mode);
    h.replies.push(json({ cart, replay: true }));
    await assert.rejects(send(), failure(0, "OPERATION_RESULT_UNKNOWN"));
    assert.deepEqual(cartSession.pendingCartChange(actor, store), change);
  }
  h.setNative("ready");
  h.replies.push(json({ cart, replay: true }));
  assert.deepEqual(await send(), { cart, replay: true });
  assert.equal(cartSession.pendingCartChange(actor, store), undefined);
  assert.ok(h.requests.every(r => r.method === "PUT" && JSON.parse(r.body).operationId === change.operationId));
});

test("Native cart never dispatches without its admitted owner origin", async t => {
  const h = harness(t, "android", false);
  assert.deepEqual(await h.api.readVerifiedCart(store, signal()), { kind: "unavailable" });
  assert.deepEqual(await h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), { kind: "unavailable" });
  await assert.rejects(h.api.replaceVerifiedCart(store, { operationId: "synthetic-no-origin", expectedVersion: 1, lines: [] }, actor, signal()), failure(503, "OWNER_UNAVAILABLE"));
  assert.equal(h.requests.length, 0);
});

test("Cart transport refuses expired or foreign admission and Native calls the actual DSH client", async t => {
  const h = harness(t, "android");
  h.admissions.push({ ...h.admission, session: { ...h.admission.session, sessionExpiresAt: "invalid" } });
  const read = await h.api.readVerifiedCart(store, signal()).catch(e => ({ error: e.code }));
  assert.deepEqual(read, { kind: "signed-out" });
  assert.equal(h.requests.length, 0);
  h.replies.push(json(cart), json(estimate));
  assert.deepEqual(await h.api.readVerifiedCart(store, signal()), { kind: "ready", cart });
  assert.deepEqual(await h.api.readVerifiedCartMerchandiseEstimate(store, 2, actor, signal()), { kind: "ready", estimate });
  assert.equal(h.native.length, 2);
  assert.ok(h.requests.every(r => r.credentials === "omit" && r.headers.Authorization.startsWith("Bearer ")));
});

test("Web retry sends the original admitted command after the caller changes its draft object", async t => {
  const h = harness(t);
  const change = { operationId: "synthetic-cart-immutable", expectedVersion: 1, lines: [{ offerId: "offer-a", quantity: 2 }] };
  const original = structuredClone(change);
  h.replies.push(new Error("lost acknowledgement"));
  await assert.rejects(h.api.replaceVerifiedCart(store, change, actor, signal()), failure(0, "OPERATION_RESULT_UNKNOWN"));
  change.lines[0].quantity = 3;
  await assert.rejects(h.api.replaceVerifiedCart(store, change, actor, signal()), failure(409, "CART_PENDING_RECONCILIATION"));
  h.replies.push(json({ cart, replay: true }));
  assert.deepEqual(await h.api.replaceVerifiedCart(store, cartSession.pendingCartChange(actor, store), actor, signal()), { cart, replay: true });
  assert.deepEqual(h.requests.map(r => JSON.parse(r.body)), [original, original]);
});
