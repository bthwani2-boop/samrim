import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CaptainStandingError, readApprovedCaptainStanding, readCaptainApplication, requestCaptainApplication,
} from "./captain-standing.ts";

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
  let controller;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (bodyError) {
      return { status: 200, ok: true, headers: new Headers({
        "Content-Type": "application/json", "Cache-Control": "no-store",
      }), text: async () => { throw new Error("connection closed during reply"); } };
    }
    controller.abort();
    assert.equal(options.signal, controller.signal);
    return ownerResponse();
  });
  controller = new AbortController();
  await expectCode(() => requestCaptainApplication(base, bearer, actor, controller.signal),
    "OPERATION_RESULT_UNKNOWN", 0);
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

test("Captain cancellation during response body never turns an uncertain POST into success", async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return {
      status: 200,
      ok: true,
      headers: new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
      text: async () => {
        controller.abort();
        return JSON.stringify(standing);
      },
    };
  });
  await expectCode(() => requestCaptainApplication(base, bearer, actor, controller.signal),
    "OPERATION_RESULT_UNKNOWN", 0);
  assert.equal(calls, 1, "a stale response must not trigger a second POST");
});

test("Captain cancellation during GET body yields a stale read, never approved access", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    text: async () => {
      controller.abort();
      return JSON.stringify({ actorId: actor, status: "APPROVED", version: 2 });
    },
  }));
  await expectCode(() => readApprovedCaptainStanding(base, bearer, "captain", actor, controller.signal),
    "OWNER_RESPONSE_STALE", 0);
});
