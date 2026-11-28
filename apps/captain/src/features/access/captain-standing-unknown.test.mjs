import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CaptainStandingError, readApprovedCaptainStanding, readCaptainApplication, requestCaptainApplication,
} from "@bthwani/dsh";

const bearer = "A".repeat(43);
const actor = "captain-synthetic";
const base = "http://127.0.0.1:3202";
const standing = { actorId: actor, status: "PENDING", version: 1 };
function ownerResponse(body = standing, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
async function expectCode(call, code, status) {
  await assert.rejects(call, error => error instanceof CaptainStandingError &&
    error.code === code && error.status === status);
}

test("Captain POST network loss after owner commit is unknown, never a definite denial", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    throw new Error("connection lost after DSH commit");
  });
  await expectCode(() => requestCaptainApplication(base, bearer, actor), "OPERATION_RESULT_UNKNOWN", 0);
  assert.equal(calls, 1, "no automatic second POST after uncertainty");
});

test("Captain POST 503/500 and lost owner response are unknown, GET failure stays unavailable", async t => {
  let failStatus = 503;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return ownerResponse({ error: "OWNER_UNAVAILABLE" }, failStatus);
  });
  for (failStatus of [500, 503, 504]) {
    await expectCode(() => requestCaptainApplication(base, bearer, actor), "OPERATION_RESULT_UNKNOWN", failStatus);
  }
  await expectCode(() => readApprovedCaptainStanding(base, bearer, "customer", actor),
    "OWNER_UNAVAILABLE", 504);
  assert.equal(calls, 4, "reads and writes never retry automatically");
});

test("Captain POST cannot call a malformed or stale successful reply an uncommitted failure", async t => {
  let response = ownerResponse();
  t.mock.method(globalThis, "fetch", async () => response);
  for (const payload of [
    { ...standing, actorId: "another-captain" },
    { ...standing, status: "SUSPENDED" },
    { ...standing, version: 0 },
    { ...standing, privateField: true },
    null,
  ]) {
    response = ownerResponse(payload);
    await expectCode(() => requestCaptainApplication(base, bearer, actor), "OPERATION_RESULT_UNKNOWN", 502);
  }
  response = ownerResponse(standing, 200, { "Cache-Control": "public" });
  await expectCode(() => requestCaptainApplication(base, bearer, actor), "OPERATION_RESULT_UNKNOWN", 502);
  response = new Response("not-json", { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  await expectCode(() => requestCaptainApplication(base, bearer, actor), "OPERATION_RESULT_UNKNOWN", 502);
});

test("Captain POST response body failure and cancellation after dispatch are unknown", async t => {
  let bodyError = false;
  let transportCancelled = false;
  let controller;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (bodyError) {
      return new Response(new ReadableStream({
        pull(stream) { stream.error(new Error("connection closed during reply")); },
      }, { highWaterMark: 0 }), { status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    controller.abort();
    transportCancelled = options.signal.aborted;
    return ownerResponse();
  });
  controller = new AbortController();
  await expectCode(() => requestCaptainApplication(base, bearer, actor, controller.signal),
    "OPERATION_RESULT_UNKNOWN", 0);
  assert.equal(transportCancelled, true);
  bodyError = true;
  await expectCode(() => requestCaptainApplication(base, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
});

test("DSH confirmed rejection stays a rejection, confirmed PENDING/APPROVED stays a valid application", async t => {
  let response = ownerResponse();
  t.mock.method(globalThis, "fetch", async () => response);
  response = ownerResponse({ error: "UNAUTHORIZED" }, 401);
  await expectCode(() => requestCaptainApplication(base, bearer, actor), "UNAUTHORIZED", 401);
  response = ownerResponse({ error: "CAPTAIN_NOT_ELIGIBLE" }, 403);
  await expectCode(() => requestCaptainApplication(base, bearer, actor), "CAPTAIN_NOT_ELIGIBLE", 403);
  response = ownerResponse();
  assert.equal(await requestCaptainApplication(base, bearer, actor), "PENDING");
  response = ownerResponse({ ...standing, status: "APPROVED", version: 2 });
  assert.equal(await requestCaptainApplication(base, bearer, actor), "APPROVED");
});

test("a failing GET does not inherit POST unknown-outcome classification", async t => {
  t.mock.method(globalThis, "fetch", async () => ownerResponse({ ...standing, status: "PENDING" }));
  await expectCode(() => readApprovedCaptainStanding(base, bearer, "customer", actor),
    "OWNER_RESPONSE_INVALID", 502);
});

test("Customer readback is a no-write, actor-scoped GET and never self-grants Captain", async t => {
  let response = ownerResponse();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response;
  });
  assert.equal(await readCaptainApplication(base, bearer, actor), "PENDING");
  response = ownerResponse({ ...standing, status: "APPROVED", version: 3 });
  assert.equal(await readCaptainApplication(base, bearer, actor), "APPROVED");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.pathname === "/v1/actors/me/captain-application" &&
    call.options.method === "GET" && call.options.credentials === "omit"));
  response = ownerResponse({ ...standing, actorId: "different-customer" });
  await expectCode(() => readCaptainApplication(base, bearer, actor), "OWNER_RESPONSE_INVALID", 502);
  response = ownerResponse({ ...standing, status: "SUSPENDED" });
  await expectCode(() => readCaptainApplication(base, bearer, actor), "OWNER_RESPONSE_INVALID", 502);
  response = ownerResponse({ error: "CAPTAIN_NOT_ELIGIBLE" }, 403);
  await expectCode(() => readCaptainApplication(base, bearer, actor), "CAPTAIN_NOT_ELIGIBLE", 403);
});

function abortingStanding(controller) {
  return new Response(new ReadableStream({
    pull(stream) {
      controller.abort();
      stream.close();
    },
  }, { highWaterMark: 0 }), { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

test("Captain cancellation during response body never turns an uncertain POST into success", async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return abortingStanding(controller);
  });
  await expectCode(() => requestCaptainApplication(base, bearer, actor, controller.signal),
    "OPERATION_RESULT_UNKNOWN", 0);
  assert.equal(calls, 1, "a stale response must not trigger a second POST");
});

test("Captain cancellation during GET body yields a stale read, never approved access", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => abortingStanding(controller));
  await expectCode(() => readApprovedCaptainStanding(base, bearer, "captain", actor, controller.signal),
    "OWNER_RESPONSE_STALE", 0);
});

test("Captain POST rejects a streamed oversized owner reply without consuming the entire body", async t => {
  let pulls = 0;
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) {
      pulls++;
      if (pulls <= 30) controller.enqueue(new Uint8Array(2048).fill(65));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }), { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
  await expectCode(() => requestCaptainApplication(base, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
  assert.ok(pulls <= 5, `owner body must stop near 4096 bytes rather than consuming ${pulls} chunks`);
  assert.equal(cancelled, true, "oversized owner reply must cancel its stream");
});

test("Captain GET refuses advertised oversized owner response before reading private data", async t => {
  let textCalled = false;
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200, ok: true,
    headers: new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store",
      "Content-Length": "999999" }),
    body: { cancel: async () => {} },
    text: async () => { textCalled = true; return JSON.stringify(standing); },
  }));
  await expectCode(() => readCaptainApplication(base, bearer, actor),
    "OWNER_RESPONSE_INVALID", 502);
  assert.equal(textCalled, false, "declared oversize must be rejected before body read");
});

test("Captain Native streaming transport remains available without a global TextEncoder", async t => {
  const valid = ownerResponse();
  t.mock.method(globalThis, "fetch", async () => valid);
  const saved = globalThis.TextEncoder;
  try {
    globalThis.TextEncoder = undefined;
    assert.equal(await requestCaptainApplication(base, bearer, actor), "PENDING");
  } finally {
    globalThis.TextEncoder = saved;
  }
});

test("Captain refuses a text-only bridge without consuming a private body", async t => {
  let consumed = false;
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200, ok: true,
    headers: new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    text: async () => { consumed = true; return JSON.stringify(standing); },
  }));
  await expectCode(() => requestCaptainApplication(base, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
  assert.equal(consumed, false);
});

test("Captain POST treats invalid streamed UTF-8 as unknown while GET refuses the read", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0xff, 0xfe]), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }));
  await expectCode(() => requestCaptainApplication(base, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
  await expectCode(() => readCaptainApplication(base, bearer, actor),
    "OWNER_RESPONSE_INVALID", 502);
});
