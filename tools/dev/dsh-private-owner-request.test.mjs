import assert from "node:assert/strict";
import { test } from "node:test";
import { DshPublicError } from "../../services/dsh/clients/client-core.ts";
import { privateOwnerRequest } from "../../services/dsh/clients/private-owner-request.ts";

const origin = "http://127.0.0.1:3202";
const bearer = "synthetic-opaque-bearer";
const path = "/v1/stores/store-a/availability";
const change = { operationId: "operation-1234", expectedVersion: 2, reason: "synthetic" };
function json(body = { storeId: "store-a" }, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
async function errorCode(task, status, code) {
  await assert.rejects(task, err => err instanceof DshPublicError &&
    err.status === status && err.code === code);
}

test("private owner GET network failure stays unavailable, PATCH is unknown without a retry", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls.push(options.method);
    throw new Error("connection lost, PATCH may have committed");
  });
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET"), 0, "OWNER_NETWORK_UNAVAILABLE");
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    0, "OPERATION_RESULT_UNKNOWN");
  assert.deepEqual(calls, ["GET", "PATCH"]);
});

test("private GET aborted before dispatch is stale and never sent", async t => {
  let dispatched = false;
  t.mock.method(globalThis, "fetch", async () => { dispatched = true; return json(); });
  const controller = new AbortController();
  controller.abort();
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET", undefined, controller.signal),
    0, "OWNER_RESPONSE_STALE");
  assert.equal(dispatched, false);
});

test("cancelled GET fetch rejection never leaks a raw AbortError into a new account", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  });
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET", undefined, controller.signal),
    0, "OWNER_RESPONSE_STALE");
});

test("cancelled GET response body cannot authorize a stale Store view", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true, status: 200,
    headers: new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    text: async () => {
      controller.abort();
      return JSON.stringify({ storeId: "store-a" });
    },
  }));
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET", undefined, controller.signal),
    0, "OWNER_RESPONSE_STALE");
});

test("cancelled PATCH response body stays unknown, never a confirmed success", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true, status: 200,
    headers: new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    text: async () => {
      controller.abort();
      return JSON.stringify({ availability: { storeId: "store-a" }, replay: false });
    },
  }));
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change, controller.signal),
    0, "OPERATION_RESULT_UNKNOWN");
});

test("cancelled PATCH after the owner sends 409 must not update a newer Store context", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false, status: 409,
    headers: new Headers(),
    text: async () => {
      controller.abort();
      return '{"code":"VERSION_CONFLICT"}';
    },
  }));
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change, controller.signal),
    0, "OPERATION_RESULT_UNKNOWN");
});

test("oversized chunked owner replies are stopped before reading the rest", { timeout: 1000 }, async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(96 * 1024 + 1));
    },
    cancel() { cancelled = true; },
  }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }));
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    502, "OPERATION_RESULT_UNKNOWN");
  assert.equal(cancelled, true);
});

test("multibyte owner text within the existing text limit remains readable", async t => {
  const result = { value: "ش".repeat(20000) };
  t.mock.method(globalThis, "fetch", async () => json(result));
  assert.deepEqual(await privateOwnerRequest(origin, path, bearer, "GET"), result);
});

test("a body on an undeclared successful HTTP status cannot confirm a write", async t => {
  t.mock.method(globalThis, "fetch", async () => json({ replay: false }, 201));
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    502, "OPERATION_RESULT_UNKNOWN");
});

test("owner can never authorize a private response missing no-store", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ storeId: "store-a" }));
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET"),
    502, "OWNER_RESPONSE_INVALID");
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    502, "OPERATION_RESULT_UNKNOWN");
});

test("confirmed 409 is a real version conflict, while 503 PATCH is uncertain", async t => {
  let status = 409;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return json({ code: status === 409 ? "VERSION_CONFLICT" : "OWNER_UNAVAILABLE" }, status);
  });
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    409, "VERSION_CONFLICT");
  status = 503;
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    503, "OPERATION_RESULT_UNKNOWN");
  assert.equal(calls, 2, "no automatic idempotency-unsafe retry");
});

test("GET and PATCH succeed only for uncached owner JSON and use an opaque bearer", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return json({ version: 3 });
  });
  assert.deepEqual(await privateOwnerRequest(origin, path, bearer, "GET"), { version: 3 });
  assert.deepEqual(await privateOwnerRequest(origin, path, bearer, "PATCH", change), { version: 3 });
  assert.deepEqual(calls.map(call => call.options.method), ["GET", "PATCH"]);
  assert.ok(calls.every(call => call.options.credentials === "omit" &&
    call.options.cache === "no-store" && call.options.redirect === "error" &&
    call.options.headers.Authorization === `Bearer ${bearer}`));
  assert.deepEqual(JSON.parse(calls[1].options.body), change);
});

test("malformed successful response remains invalid GET and uncertain PATCH", async t => {
  let res = new Response("<html>not owner JSON</html>", { status: 200,
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  t.mock.method(globalThis, "fetch", async () => res);
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET"),
    502, "OWNER_RESPONSE_INVALID");
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    502, "OPERATION_RESULT_UNKNOWN");
  res = new Response("not json", { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "GET"),
    502, "OWNER_RESPONSE_INVALID");
  await errorCode(() => privateOwnerRequest(origin, path, bearer, "PATCH", change),
    502, "OPERATION_RESULT_UNKNOWN");
});
