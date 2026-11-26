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
const source = path.join(import.meta.dirname, "cart-directory-transport.ts");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-cart-directory-transport-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--inlineSourceMap", "--inlineSources", "--outDir", temp],
    { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "cart-directory-transport.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

const actor = "synthetic-customer-a";
const origin = "http://127.0.0.1:3202";
const bearer = Buffer.alloc(32, 14).toString("base64url");
const page = { actorId: actor, carts: [{ storeId: "store-b", storeName: "Synthetic store", version: 1, lineCount: 1 }] };
const failure = (status, code) => error => error instanceof dsh.DshPublicError && error.status === status && error.code === code;
const signal = () => new AbortController().signal;
const json = (body, status = 200, cache = "no-store") => Response.json(body, { status, headers: { "Cache-Control": cache } });

function harness(t, os = "web", configured = true) {
  const expiresAt = Date.now() + 120000;
  const state = (actorId = actor, expiry = expiresAt, role = "customer") =>
    ({ enabled: true, session: { actorId, role, sessionExpiresAt: new Date(expiry).toISOString() } });
  const admissions = [], replies = [], requests = [], nativeCalls = [];
  let nativeOutcome = "ready";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), ...init });
    assert.ok(replies.length, "unexpected owner request");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const key = "EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN";
  const previous = process.env[key];
  let api;
  try {
    if (configured) process.env[key] = origin;
    else delete process.env[key];
    api = loadMappedRenderFixture(compiled, source, {
      "@bthwani/dsh": dsh,
      "react-native": { Platform: { OS: os } },
      "../access/bounded-customer-json": { readBoundedCustomerJSON },
      "../access/customer-session-transport": {
        async readCustomerAdmission() { return admissions.length ? admissions.shift() : state(); },
        async withVerifiedNativeCustomerRead(s, read, expectedActor) {
          nativeCalls.push({ signal: s, actor: expectedActor });
          if (nativeOutcome !== "ready") return { kind: nativeOutcome };
          return { kind: "ready", value: await read(bearer), expiresAt: expiresAt - 1000 };
        },
      },
    }).exports;
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  return { api, expiresAt, state, admissions, replies, requests, nativeCalls, native(kind) { nativeOutcome = kind; } };
}

test("directory rejects malformed cursor, disabled admission, wrong role/actor, expired or aborted sessions without dispatch", async t => {
  const h = harness(t);
  await assert.rejects(h.api.readVerifiedCartDirectory(signal(), "../store"), failure(400, "INVALID_REQUEST"));
  h.admissions.push({ enabled: false, session: null });
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(503, "OWNER_UNAVAILABLE"));
  for (const state of [
    { enabled: true, session: null },
    h.state(actor, h.expiresAt, "merchant"),
    h.state("other-customer"),
    h.state(actor, Date.now() - 1000),
    { enabled: true, session: { actorId: actor, role: "customer", sessionExpiresAt: "invalid-date" } },
  ]) {
    h.admissions.push(state);
    await assert.rejects(h.api.readVerifiedCartDirectory(signal(), undefined, actor), failure(401, "UNAUTHORIZED"));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.api.readVerifiedCartDirectory(controller.signal), { name: "AbortError" });
  assert.equal(h.requests.length, 0);
});

test("Web directory verifies both sides, sends only bounded cursor and customer context, and uses earliest expiry", async t => {
  const h = harness(t);
  const s = signal();
  const shorter = h.expiresAt - 30000;
  h.admissions.push(h.state(), h.state(actor, shorter));
  h.replies.push(json(page), json({ actorId: actor, carts: [] }));
  assert.deepEqual(await h.api.readVerifiedCartDirectory(s, "store-a", actor), { value: page, expiresAt: shorter });
  assert.deepEqual(await h.api.readVerifiedCartDirectory(s), { value: { actorId: actor, carts: [] }, expiresAt: h.expiresAt });
  assert.deepEqual(h.requests.map(r => r.url), ["/api/customer-auth/carts?after=store-a", "/api/customer-auth/carts"]);
  for (const r of h.requests) {
    assert.equal(r.method, "GET");
    assert.equal(r.credentials, "same-origin");
    assert.equal(r.redirect, "error");
    assert.equal(r.cache, "no-store");
    assert.equal(r.headers["X-Customer-Context"], actor);
    assert.equal(r.signal, s);
  }
});

test("Web directory rejects denied, unavailable, cacheable and invalid bounded responses", async t => {
  const h = harness(t);
  let cancelled = false;
  h.replies.push(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 401 }));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(401, "DIRECTORY_REQUEST_REJECTED"));
  assert.equal(cancelled, true);
  h.replies.push(new Response(new ReadableStream({ cancel() { throw new Error("cancel failed"); } }), { status: 503 }));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(503, "DIRECTORY_REQUEST_REJECTED"));
  h.replies.push(json({}, 403), new Response(null, { status: 503 }), json(page, 200, "public"), Response.json(page));
  for (const status of [401, 503, 503, 503]) {
    await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(status, "DIRECTORY_REQUEST_REJECTED"));
  }
  h.replies.push(json({ ...page, actorId: "other-customer" }), json(page), new Response("{}", { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } }),
    new Response("{}", { headers: { "Cache-Control": "no-store", "Content-Type": "application/json", "Content-Length": "32769" } }));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(502, "OWNER_RESPONSE_INVALID"));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal(), "store-b"), failure(502, "OWNER_RESPONSE_INVALID"));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(502, "OWNER_RESPONSE_INVALID"));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(502, "OWNER_RESPONSE_INVALID"));
});

test("Web directory discards an otherwise valid reply after actor replacement or expiry", async t => {
  const h = harness(t);
  h.replies.push(json(page), json(page));
  h.admissions.push(h.state(), h.state("other-customer"), h.state(), h.state(actor, Date.now() - 1000));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal(), undefined, actor), failure(401, "UNAUTHORIZED"));
  await assert.rejects(h.api.readVerifiedCartDirectory(signal(), undefined, actor), failure(401, "UNAUTHORIZED"));
});

test("Android directory uses real DSH client inside native verification and bounds returned expiry", async t => {
  const h = harness(t, "android");
  const s = signal();
  h.replies.push(json(page));
  assert.deepEqual(await h.api.readVerifiedCartDirectory(s, "store-a", actor), { value: page, expiresAt: h.expiresAt - 1000 });
  assert.deepEqual(h.nativeCalls, [{ actor, signal: s }]);
  assert.equal(h.requests[0].url, `${origin}/v1/carts?after=store-a`);
  assert.equal(h.requests[0].headers.Authorization, `Bearer ${bearer}`);
  assert.equal(h.requests[0].credentials, "omit");
  assert.equal(h.requests[0].signal, s);
});

test("Android directory rejects missing owner and denied native scope without dispatch", async t => {
  const h = harness(t, "android", false);
  await assert.rejects(h.api.readVerifiedCartDirectory(signal()), failure(503, "OWNER_UNAVAILABLE"));
  assert.equal(h.nativeCalls.length, 0);
  assert.equal(h.requests.length, 0);
});

test("Android directory does not expose owner rows when native verification denies or fails", async t => {
  const h = harness(t, "android");
  h.native("signed-out");
  await assert.rejects(h.api.readVerifiedCartDirectory(signal(), undefined, actor), failure(401, "DIRECTORY_REQUEST_REJECTED"));
  h.native("unavailable");
  await assert.rejects(h.api.readVerifiedCartDirectory(signal(), undefined, actor), failure(503, "DIRECTORY_REQUEST_REJECTED"));
  assert.equal(h.requests.length, 0);
});
