import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as dsh from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";

const root = path.resolve(import.meta.dirname, "../../../../..");
const source = path.join(import.meta.dirname, "address-transport.ts");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-address-transport-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--inlineSourceMap", "--inlineSources", "--outDir", temp],
    { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "address-transport.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

const actor = "synthetic-customer-a";
const id = "addr-" + "1".repeat(32);
const after = "addr-" + "0".repeat(32);
const store = "store-a";
const origin = "http://127.0.0.1:3202";
const bearer = Buffer.alloc(32, 14).toString("base64url");
const change = { cityId: "sanaa", label: "Test home", details: "Synthetic address", latitude: 15.3, longitude: 44.2, expectedVersion: 0 };
const { expectedVersion: _version, ...fields } = change;
const address = { id, ...fields, version: 1 };
const page = { actorId: actor, items: [address] };
const readback = { actorId: actor, address };
const receipt = { ...readback, replay: false };
const serviceability = { actorId: actor, storeId: store, addressId: id, status: "UNAVAILABLE" };
const signal = () => new AbortController().signal;
const retainedModules = [];
const failure = (status, code) => error => error instanceof dsh.DshPublicError && error.status === status && error.code === code;
const json = (body, status = 200, cache = "no-store") => Response.json(body, { status, headers: { "Cache-Control": cache } });

function harness(t, os = "web", configured = true) {
  const expiresAt = Date.now() + 120000;
  const state = (actorId = actor, expiry = expiresAt, role = "customer") =>
    ({ enabled: true, session: { actorId, role, sessionExpiresAt: new Date(expiry).toISOString() } });
  const admissions = [], replies = [], requests = [], nativeCalls = [];
  let nativeOutcome = "ready";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), ...init });
    assert.ok(replies.length, "unexpected request");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(init) : next;
  });
  const envKey = "EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN";
  const previous = process.env[envKey];
  let api;
  try {
    if (configured) process.env[envKey] = origin;
    else delete process.env[envKey];
    const fixture = loadMappedRenderFixture(compiled, source, {
      "@bthwani/dsh": dsh,
      "../access/bounded-customer-json": { readBoundedCustomerJSON },
      "react-native": { Platform: { OS: os } },
      "../access/customer-session-transport": {
        async readCustomerAdmission() { return admissions.length ? admissions.shift() : state(); },
        async withVerifiedNativeCustomerRead(s, ownerRead, expectedActor) {
          nativeCalls.push({ signal: s, actor: expectedActor });
          if (nativeOutcome === "signed-out" || nativeOutcome === "unavailable") return { kind: nativeOutcome };
          const value = await ownerRead(bearer);
          return nativeOutcome === "late-signout" ? { kind: "signed-out" } :
            { kind: "ready", value, expiresAt: expiresAt - 1000 };
        },
      },
    });
    retainedModules.push(fixture);
    api = fixture.exports;
  } finally {
    if (previous === undefined) delete process.env[envKey];
    else process.env[envKey] = previous;
  }
  return { api, expiresAt, state, admissions, replies, requests, nativeCalls, native(kind) { nativeOutcome = kind; } };
}

test("address admission rejects disabled, expired, malformed, foreign and aborted sessions before any owner request", async t => {
  const h = harness(t);
  for (const state of [
    { enabled: false, session: null },
    { enabled: true, session: null },
    h.state(actor, h.expiresAt, "merchant"),
    h.state("other-customer"),
    h.state(actor, Date.now() - 1000),
    { enabled: true, session: { actorId: actor, role: "customer", sessionExpiresAt: "invalid-date" } },
  ]) {
    h.admissions.push(state);
    await assert.rejects(h.api.readVerifiedAddresses(signal(), actor), failure(401, "UNAUTHORIZED"));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.api.readVerifiedAddresses(controller.signal, actor), { name: "AbortError" });
  assert.equal(h.requests.length, 0);
});

test("Web address operations verify actor and expiry on both sides of the real route and parse owner evidence", async t => {
  const h = harness(t);
  const s = signal();
  const shorter = h.expiresAt - 30000;
  h.admissions.push(h.state(), h.state(actor, shorter));
  h.replies.push(json(page), json(readback), json(serviceability), json(receipt));
  assert.deepEqual(await h.api.readVerifiedAddresses(s, actor, after), { page, expiresAt: shorter });
  assert.deepEqual(await h.api.readVerifiedAddress(s, actor, id), { address, expiresAt: h.expiresAt });
  assert.deepEqual(await h.api.readVerifiedDeliveryServiceability(actor, store, id, s), serviceability);
  assert.deepEqual(await h.api.writeVerifiedAddress(actor, id, change, s), receipt);
  assert.deepEqual(h.requests.map(r => [r.method, r.url]), [
    ["GET", "/api/customer-auth/addresses?after=" + after],
    ["GET", "/api/customer-auth/addresses?addressId=" + id],
    ["GET", "/api/customer-auth/serviceability?storeId=" + store + "&addressId=" + id],
    ["PUT", "/api/customer-auth/addresses?addressId=" + id],
  ]);
  for (const r of h.requests) {
    assert.equal(r.headers["X-Customer-Context"], actor);
    assert.equal(r.credentials, "same-origin");
    assert.equal(r.redirect, "error");
    assert.equal(r.cache, "no-store");
    assert.equal(r.signal, s);
  }
  assert.deepEqual(JSON.parse(h.requests[3].body), change);
});

test("Web reads reject wrong actor, invalid cache policy, missing address and lost owner replies", async t => {
  const h = harness(t);
  await assert.rejects(h.api.readVerifiedAddress(signal(), actor, "../foreign"), failure(400, "INVALID_REQUEST"));
  assert.equal(h.requests.length, 0);
  h.replies.push(json(page));
  h.admissions.push(h.state(), h.state("other-customer"));
  await assert.rejects(h.api.readVerifiedAddresses(signal(), actor), failure(401, "UNAUTHORIZED"));
  h.replies.push(json(page, 200, "public"));
  await assert.rejects(h.api.readVerifiedAddresses(signal()), failure(502, "OWNER_RESPONSE_INVALID"));
  h.replies.push(json({ actorId: "other-customer", items: [] }));
  await assert.rejects(h.api.readVerifiedAddresses(signal()), failure(502, "OWNER_RESPONSE_INVALID"));
  h.replies.push(json({ error: "NOT_FOUND" }, 404));
  await assert.rejects(h.api.readVerifiedAddress(signal(), actor, id), failure(404, "ADDRESS_REQUEST_REJECTED"));
  h.replies.push(new Error("owner unavailable"));
  await assert.rejects(h.api.readVerifiedAddresses(signal()), failure(503, "OWNER_UNAVAILABLE"));
  h.replies.push(json(serviceability));
  h.admissions.push(h.state(), h.state("other-customer"));
  await assert.rejects(h.api.readVerifiedDeliveryServiceability(actor, store, id, signal()), failure(401, "UNAUTHORIZED"));
});

test("Web mutation preserves definite rejections but never retries or reports unknown outcomes as confirmed", async t => {
  const h = harness(t);
  for (const status of [400, 404, 409]) {
    h.replies.push(json({ error: "rejected" }, status));
    await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(status, "ADDRESS_REQUEST_REJECTED"));
  }
  for (const response of [json({}, 503), new Error("lost response"), json({ ...receipt, actorId: "other-customer" })]) {
    h.replies.push(response);
    await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(503, "OPERATION_RESULT_UNKNOWN"));
  }
  h.replies.push(json(receipt));
  h.admissions.push(h.state(), h.state("other-customer"));
  await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(503, "OPERATION_RESULT_UNKNOWN"));
  assert.equal(h.requests.length, 7, "one dispatch per explicit command");
});

test("Web reads reject noncanonical responses and release rejected bodies", async t => {
  const h = harness(t);
  const response = (body, headers, status = 200) => new Response(body, {
    status, headers: { "Cache-Control": "no-store", ...headers },
  });
  for (const bad of [
    response(JSON.stringify(page), { "Content-Type": "text/plain" }),
    response(JSON.stringify(page), { "Content-Type": "application/json", "Content-Length": "32769" }),
    response(JSON.stringify(page) + " ".repeat(32769), { "Content-Type": "application/json" }),
    json(page, 201),
  ]) {
    h.replies.push(bad);
    await assert.rejects(h.api.readVerifiedAddresses(signal(), actor), failure(502, "OWNER_RESPONSE_INVALID"));
  }
  let cancelled = false;
  h.replies.push(response(new ReadableStream({ cancel() { cancelled = true; } }), { "Content-Type": "application/json" }, 409));
  await assert.rejects(h.api.readVerifiedAddresses(signal(), actor), failure(409, "ADDRESS_REQUEST_REJECTED"));
  assert.equal(cancelled, true);
});

test("Web address save rejects invalid success evidence without replay", async t => {
  const h = harness(t);
  for (const bad of [
    new Response(JSON.stringify(receipt), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } }),
    new Response(JSON.stringify(receipt) + " ".repeat(32769), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }),
    json(receipt, 201),
  ]) {
    h.replies.push(bad);
    await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(503, "OPERATION_RESULT_UNKNOWN"));
  }
  assert.equal(h.requests.length, 3);
  assert.ok(h.requests.every(r => r.method === "PUT"));
});

test("Web address save abort releases a stalled body and permits independent readback", async t => {
  const h = harness(t);
  const controller = new AbortController();
  let streamController, cancelled = false, timer;
  h.replies.push(new Response(new ReadableStream({
    start(c) { streamController = c; },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
  const pending = h.api.writeVerifiedAddress(actor, id, change, controller.signal)
    .then(() => "UNEXPECTED_SUCCESS", error => ({ status: error.status, code: error.code }));
  try {
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    const watchdog = new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 500); });
    assert.deepEqual(await Promise.race([pending, watchdog]), { status: 503, code: "OPERATION_RESULT_UNKNOWN" });
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timer);
    if (!cancelled) streamController.close();
    await pending;
  }
  assert.equal(h.requests.length, 1);
  h.replies.push(json(readback));
  assert.deepEqual(await h.api.readVerifiedAddress(signal(), actor, id), { address, expiresAt: h.expiresAt });
  assert.deepEqual(h.requests.map(r => r.method), ["PUT", "GET"]);
});

test("Android uses the real DSH SDK within verified native scope and bounds expiry", async t => {
  const h = harness(t, "android");
  const s = signal();
  h.replies.push(json(page), json(readback), json(receipt), json(serviceability));
  assert.deepEqual(await h.api.readVerifiedAddresses(s, actor, after), { page, expiresAt: h.expiresAt - 1000 });
  assert.deepEqual(await h.api.readVerifiedAddress(s, actor, id), { address, expiresAt: h.expiresAt - 1000 });
  assert.deepEqual(await h.api.writeVerifiedAddress(actor, id, change, s), receipt);
  assert.deepEqual(await h.api.readVerifiedDeliveryServiceability(actor, store, id, s), serviceability);
  assert.deepEqual(h.requests.map(r => [r.method, r.url]), [
    ["GET", origin + "/v1/addresses?after=" + after],
    ["GET", origin + "/v1/addresses/" + id],
    ["PUT", origin + "/v1/addresses/" + id],
    ["GET", origin + "/v1/carts/" + store + "/serviceability?addressId=" + id],
  ]);
  for (const request of h.requests) {
    assert.equal(request.headers.Authorization, "Bearer " + bearer);
    assert.equal(request.credentials, "omit");
    assert.ok(request.signal instanceof AbortSignal);
    assert.notEqual(request.signal, s, "owner SDK owns the bounded transport signal");
    assert.equal(request.signal.aborted, false);
  }
  assert.ok(h.nativeCalls.every(r => r.actor === actor && r.signal === s));
  assert.deepEqual(JSON.parse(h.requests[2].body), change);
});

test("Android caller cancellation interrupts the actual SDK transport and discards a late response", async t => {
  const h = harness(t, "android");
  const controller = new AbortController();
  let entered, release;
  const dispatched = new Promise(resolve => { entered = resolve; });
  const late = new Promise(resolve => { release = resolve; });
  let transportSignal, cancelled = false;
  h.replies.push(init => {
    transportSignal = init.signal;
    entered();
    return late;
  });
  const response = new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const pending = h.api.readVerifiedAddresses(controller.signal, actor);
  try {
    await dispatched;
    assert.notEqual(transportSignal, controller.signal);
    assert.equal(transportSignal.aborted, false);
    controller.abort();
    await assert.rejects(pending, failure(0, "OWNER_RESPONSE_STALE"));
    assert.equal(transportSignal.aborted, true);
    assert.equal(h.requests.length, 1);
  } finally {
    release(response);
    await pending.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(cancelled, true);
  h.replies.push(json(page));
  assert.deepEqual(await h.api.readVerifiedAddresses(signal(), actor), { page, expiresAt: h.expiresAt - 1000 });
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].signal.aborted, false);
});

test("Android unavailable or revoked native scope does not expose owner data or permit an unconfirmed save", async t => {
  const h = harness(t, "android");
  h.native("signed-out");
  await assert.rejects(h.api.readVerifiedAddresses(signal()), failure(401, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedAddress(signal(), actor, id), failure(401, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedDeliveryServiceability(actor, store, id, signal()), failure(401, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(503, "OPERATION_RESULT_UNKNOWN"));
  h.native("unavailable");
  await assert.rejects(h.api.readVerifiedAddresses(signal()), failure(503, "OWNER_UNAVAILABLE"));
  assert.equal(h.requests.length, 0);
  h.native("late-signout");
  h.replies.push(json(receipt));
  await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(503, "OPERATION_RESULT_UNKNOWN"));
  assert.equal(h.requests.length, 1);
});

test("Android without an admitted DSH origin never dispatches", async t => {
  const h = harness(t, "android", false);
  await assert.rejects(h.api.readVerifiedAddresses(signal()), failure(503, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedAddress(signal(), actor, id), failure(503, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.writeVerifiedAddress(actor, id, change, signal()), failure(503, "OWNER_UNAVAILABLE"));
  await assert.rejects(h.api.readVerifiedDeliveryServiceability(actor, store, id, signal()), failure(503, "OWNER_UNAVAILABLE"));
  assert.equal(h.requests.length, 0);
  assert.equal(h.nativeCalls.length, 0);
});

test("Web and Android capture the same canonical command before asynchronous admission", async t => {
  for (const os of ["web", "android"]) {
    const h = harness(t, os);
    const draft = { ...change, label: "\u0085Test home\u0085", details: "\ufeffSynthetic address" };
    const canonical = { ...change, details: "\ufeffSynthetic address" };
    h.replies.push(json({ ...receipt, address: { ...address, details: canonical.details } }));
    const result = h.api.writeVerifiedAddress(actor, id, draft, signal());
    draft.label = "different draft";
    draft.expectedVersion = 9;
    assert.deepEqual(await result, { ...receipt, address: { ...address, details: canonical.details } });
    assert.deepEqual(JSON.parse(h.requests[0].body), canonical);
  }
});
