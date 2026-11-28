import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedOwnerJSON } from "./client-core.ts";
import { CaptainStandingError, captainStandingFrom, readApprovedCaptainStanding, readCaptainApplication, requestCaptainApplication } from "./index.ts";

test("non-streaming owner response is refused before unbounded text consumption", async () => {
  let read = false;
  const response = {
    headers: new Headers(),
    text: async () => { read = true; return '{"valid":true}'; },
  };
  await assert.rejects(() => readBoundedOwnerJSON(response, 128, 256));
  assert.equal(read, false);
});

test("abandoned pending body read cancels and releases the reader", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() { cancelled = true; },
  });
  const result = readBoundedOwnerJSON(new Response(stream), 128, 256, abort.signal);
  abort.abort();
  let timer;
  try {
    await assert.rejects(Promise.race([result, new Promise(resolve => {
      timer = setTimeout(() => resolve("not cancelled"), 150);
    })]), /cancel|abort/i);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  } finally {
    clearTimeout(timer);
    if (!stream.locked) void stream.cancel().catch(() => {});
  }
});

test("stream byte bounds are enforced before consuming the remaining data", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(257)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(() => readBoundedOwnerJSON(new Response(stream), 128, 256), /Oversized/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("a stalled body has an absolute deadline and releases its reader", { timeout: 7000 }, async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() { cancelled = true; },
  });
  let timer;
  try {
    await assert.rejects(Promise.race([
      readBoundedOwnerJSON(new Response(stream), 128, 256),
      new Promise(resolve => { timer = setTimeout(() => resolve("no deadline"), 5500); }),
    ]), /deadline/i);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  } finally {
    clearTimeout(timer);
    if (!stream.locked) void stream.cancel().catch(() => {});
  }
});

const bearer = Buffer.alloc(32, 7).toString("base64url");
const origin = "http://127.0.0.1:33222";
function abortingReply(t, abort, status = 200) {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) { abort.abort(); controller.close(); },
  }, { highWaterMark: 0 }), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }));
}
test("cart owner body cancellation preserves stale read classification", async t => {
  const { readCurrentCustomerCart } = await import("./customer-cart.ts");
  const abort = new AbortController();
  abortingReply(t, abort);
  await assert.rejects(readCurrentCustomerCart(origin, bearer, "store-1", "actor-1", abort.signal),
    { status: 0, code: "OWNER_RESPONSE_STALE" });
});
test("merchant standing owner body cancellation preserves stale classification", async t => {
  const { readMerchantDSHStanding } = await import("./merchant-standing.ts");
  const abort = new AbortController();
  abortingReply(t, abort);
  await assert.rejects(readMerchantDSHStanding(origin, bearer, abort.signal),
    { status: 0, code: "OWNER_RESPONSE_STALE" });
});
test("merchant registration body cancellation preserves read and write outcomes", async t => {
  const { readMerchantRegistrationOptions, registerMerchantStore } = await import("./merchant-registration.ts");
  const abort = new AbortController();
  abortingReply(t, abort);
  await assert.rejects(readMerchantRegistrationOptions(origin, bearer, abort.signal),
    { status: 0, code: "OWNER_RESPONSE_STALE" });
  t.mock.restoreAll();
  const write = new AbortController();
  abortingReply(t, write, 409);
  await assert.rejects(registerMerchantStore(origin, bearer, {
    operationId: "register-store-001", name: "Store One", cityId: "sanaa",
    relation: "MARKETPLACE", verticalId: "grocery", latitude: 15.3694,
    longitude: 44.191, policyVersion: 1, termsVersion: "merchant-terms-v1", acceptedTerms: true,
  }, write.signal), { status: 0, code: "OPERATION_RESULT_UNKNOWN" });
});

const registration = {
  operationId: "register-store-001", name: "Store One", cityId: "sanaa",
  relation: "MARKETPLACE", verticalId: "grocery", latitude: 15.3694,
  longitude: 44.191, policyVersion: 1, termsVersion: "merchant-terms-v1", acceptedTerms: true,
};
const interest = {
  name: "Test Captain", phone: "771234567", city: "Sanaa", district: "Test District",
  vehicleType: "MOTORCYCLE", plateRegistered: true, phoneType: "SMART", experienced: false,
};

async function ownerCalls() {
  const privateApi = await import("./private-owner-request.ts");
  const discovery = await import("./public-discovery.ts");
  const cart = await import("./customer-cart.ts");
  const captain = await import("./captain-standing.ts");
  const guest = await import("./captain-interest.ts");
  const merchant = await import("./merchant-standing.ts");
  const registrations = await import("./merchant-registration.ts");
  return [
    ["private read", s => privateApi.privateOwnerRequest(origin, "/v1/stores/store-1/availability", bearer, "GET", undefined, s), 200],
    ["private write", s => privateApi.privateOwnerRequest(origin, "/v1/stores/store-1/availability", bearer, "PATCH", {}, s), 200],
    ["discovery", s => discovery.getPublicStore(origin, "store-1", s), 200],
    ["cart", s => cart.readCurrentCustomerCart(origin, bearer, "store-1", "actor-1", s), 200],
    ["captain standing", s => captain.readApprovedCaptainStanding(origin, bearer, "captain", "actor-1", s), 200],
    ["guest interest", s => guest.submitCaptainInterest(origin, interest, s), 202],
    ["merchant standing", s => merchant.readMerchantDSHStanding(origin, bearer, s), 200],
    ["registration read", s => registrations.readMerchantRegistrationOptions(origin, bearer, s), 200],
    ["registration write", s => registrations.registerMerchantStore(origin, bearer, registration, s), 201],
  ];
}

test("all direct DSH transports discard an abandoned response before reading it", async t => {
  for (const [name, call, status] of await ownerCalls()) {
    await t.test(name, async child => {
      const abort = new AbortController();
      let cancelled = 0;
      const body = new ReadableStream({ cancel() { cancelled++; } });
      child.mock.method(globalThis, "fetch", async () => {
        abort.abort();
        return new Response(body, { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      });
      await assert.rejects(call(abort.signal), { code: /OWNER_RESPONSE_STALE|OPERATION_RESULT_UNKNOWN/ });
      assert.equal(cancelled, 1, "abandoned body must be cancelled");
      assert.equal(body.locked, false);
    });
  }
});

test("all direct DSH transports discard rejected success media without reading", async t => {
  for (const [name, call, status] of await ownerCalls()) {
    await t.test(name, async child => {
      let cancelled = 0;
      const body = new ReadableStream({ cancel() { cancelled++; } });
      child.mock.method(globalThis, "fetch", async () => new Response(body, {
        status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      }));
      await assert.rejects(call(new AbortController().signal), { code: /OWNER_RESPONSE_INVALID|OPERATION_RESULT_UNKNOWN/ });
      assert.equal(cancelled, 1, "rejected body must be cancelled");
      assert.equal(body.locked, false);
    });
  }
});

test("private DSH representations reject every noncanonical no-store value before reading", async t => {
  const invalid = [null, "public", "no-store-unsafe", "no-store=1",
    'extension="before,no-store,after"', 'extension="escaped\\",no-store,after"',
    "no-store, public", "no-store, no-store"];
  const calls = (await ownerCalls()).filter(([name]) => name !== "discovery");
  for (const [name, call, status] of calls) {
    await t.test(name, async child => {
      const expected = ["private write", "guest interest", "registration write"].includes(name)
        ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID";
      for (const cache of invalid) {
        let reads = 0, cancelled = 0;
        const body = new ReadableStream({
          pull(controller) { reads++; controller.close(); },
          cancel() { cancelled++; },
        }, { highWaterMark: 0 });
        const headers = { "Content-Type": "application/json" };
        if (cache !== null) headers["Cache-Control"] = cache;
        child.mock.method(globalThis, "fetch", async () => new Response(body, { status, headers }));
        await assert.rejects(call(new AbortController().signal), { status: 502, code: expected });
        assert.equal(reads, 0);
        assert.equal(cancelled, 1);
        assert.equal(body.locked, false);
        child.mock.restoreAll();
      }
    });
  }
});

test("private owner rejection metadata cannot assert a forged conflict code", async t => {
  const { privateOwnerRequest } = await import("./private-owner-request.ts");
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "VERSION_CONFLICT" }, {
    status: 409, headers: { "Cache-Control": 'extension="before,no-store,after"' },
  }));
  await assert.rejects(privateOwnerRequest(origin, "/v1/stores/store-1/availability", bearer, "PATCH", {}),
    { status: 409, code: "STORE_OPERATION_FAILED" });
});

test("direct status-only owner rejections discard the unread body without waiting", async t => {
  const calls = await ownerCalls();
  for (const [name, call] of calls.filter(([name]) => ["cart", "captain standing", "guest interest", "merchant standing"].includes(name))) {
    await t.test(name, async child => {
      let cancelled = 0;
      const body = new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } });
      child.mock.method(globalThis, "fetch", async () => new Response(body, {
        status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      }));
      await assert.rejects(call(new AbortController().signal));
      assert.equal(cancelled, 1);
      assert.equal(body.locked, false);
    });
  }
});

test("real loopback HTTP rejection closes the abandoned owner stream and permits a fresh request", { timeout: 5000 }, async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { privateOwnerRequest } = await import("./private-owner-request.ts");
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (requests === 1) {
      response.on("close", closed);
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      response.write("rejected media, intentionally unfinished");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"recovered":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let watchdog;
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    await assert.rejects(privateOwnerRequest(base, "/v1/test", bearer, "GET"), { code: "OWNER_RESPONSE_INVALID" });
    const timeout = new Promise(resolve => { watchdog = setTimeout(() => resolve(false), 1500); });
    assert.notEqual(await Promise.race([disconnected, timeout]), false, "socket remained open after rejected body");
    assert.deepEqual(await privateOwnerRequest(base, "/v1/test", bearer, "GET"), { recovered: true });
    assert.equal(requests, 2);
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("cleanup cannot replace an authoritative response outcome even when native accessors throw", async () => {
  const { consumeOwnerResponse } = await import("./client-core.ts");
  const denial = new Error("authoritative owner denial");
  const response = { get bodyUsed() { throw new Error("native body state unavailable"); } };
  await assert.rejects(consumeOwnerResponse(response, async () => { throw denial; }), error => error === denial);
  assert.equal(await consumeOwnerResponse(response, async () => "accepted"), "accepted");
});

test("reader cancellation sync exceptions and asynchronous rejections retain the original byte rejection", async () => {
  for (const cancel of [
    () => { throw new Error("native synchronous cleanup failure"); },
    () => Promise.reject(new Error("native asynchronous cleanup failure")),
    () => new Promise(() => {}),
  ]) {
    let released = false;
    let cancelled = 0;
    const reader = {
      read: async () => ({ done: false, value: new Uint8Array(257) }),
      cancel() { cancelled++; return cancel(); },
      releaseLock() { released = true; },
    };
    const response = { headers: new Headers(), body: { getReader: () => reader } };
    await assert.rejects(readBoundedOwnerJSON(response, 128, 256), /Oversized DSH owner reply/);
    assert.equal(cancelled, 1);
    assert.equal(released, true);
  }
});

test("unread response cancellation is best effort and never waits for cleanup", async () => {
  const { consumeOwnerResponse } = await import("./client-core.ts");
  for (const cancel of [
    () => { throw new Error("native synchronous cleanup failure"); },
    () => Promise.reject(new Error("native asynchronous cleanup failure")),
    () => new Promise(() => {}),
  ]) {
    let cancelled = 0;
    const response = { bodyUsed: false, body: { locked: false, cancel() { cancelled++; return cancel(); } } };
    const denial = new Error("owner denied");
    await assert.rejects(consumeOwnerResponse(response, async () => { throw denial; }), error => error === denial);
    assert.equal(cancelled, 1);
  }
});

test("pre-aborted and unadmitted response bodies are discarded without reader acquisition", async () => {
  const caller = new AbortController();
  caller.abort();
  let cancelled = 0;
  let acquired = 0;
  const body = {
    locked: false,
    getReader() { acquired++; throw new Error("must not read"); },
    async cancel() { cancelled++; },
  };
  await assert.rejects(readBoundedOwnerJSON({ headers: new Headers(), body }, 128, 256, caller.signal), /cancelled/);
  await assert.rejects(readBoundedOwnerJSON({ headers: new Headers({ "Content-Length": "invalid" }), body }, 128, 256), /invalid/);
  assert.equal(acquired, 0);
  assert.equal(cancelled, 2);
});

test("abort during native reader acquisition still releases ownership", async () => {
  const caller = new AbortController();
  let cancelled = 0;
  let released = false;
  const response = {
    headers: new Headers(),
    body: {
      getReader() {
        caller.abort();
        return {
          read: () => new Promise(() => {}),
          async cancel() { cancelled++; },
          releaseLock() { released = true; },
        };
      },
    },
  };
  await assert.rejects(readBoundedOwnerJSON(response, 128, 256, caller.signal), /cancelled/);
  assert.equal(cancelled, 1);
  assert.equal(released, true);
});

test("cleanup never acquires a locked or already-consumed body", async () => {
  const { consumeOwnerResponse } = await import("./client-core.ts");
  let cancelled = 0;
  for (const response of [
    { bodyUsed: true, get body() { throw new Error("body already owned"); } },
    { bodyUsed: false, body: { locked: true, async cancel() { cancelled++; } } },
    { bodyUsed: false, body: null },
  ]) {
    assert.equal(await consumeOwnerResponse(response, async () => 42), 42);
  }
  assert.equal(cancelled, 0);
});

test("all DSH transports release cancelled header waits and discard late replies", async t => {
  for (const [name, call, status] of await ownerCalls()) {
    await t.test(name, async child => {
      const caller = new AbortController();
      const started = Promise.withResolvers();
      let deliver, cancelled = 0, calls = 0;
      child.mock.method(globalThis, "fetch", () => {
        calls++;
        started.resolve();
        return new Promise(resolve => { deliver = resolve; });
      });
      const pending = call(caller.signal).then(() => "SUCCESS", error => error.code ?? error.name);
      await started.promise;
      caller.abort();
      let timer;
      try {
        const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 150); })]);
        assert.match(result, /OWNER_RESPONSE_STALE|OPERATION_RESULT_UNKNOWN/);
      } finally {
        clearTimeout(timer);
        deliver(new Response(new ReadableStream({ cancel() { cancelled++; } }), {
          status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }));
        await pending;
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cancelled, 1);
      assert.equal(calls, 1);
    });
  }
});

test("DSH header deadline aborts the transport without caller cancellation or retry", async t => {
  const { privateOwnerRequest } = await import("./private-owner-request.ts");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const caller = new AbortController();
  let signal, calls = 0, deliver;
  t.mock.method(globalThis, "fetch", (_url, init) => {
    signal = init.signal;
    calls++;
    return new Promise(resolve => { deliver = resolve; });
  });
  const result = privateOwnerRequest(origin, "/v1/test", bearer, "PATCH", {}, caller.signal)
    .then(() => "SUCCESS", error => error.code);
  t.mock.timers.tick(10_000);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(signal.aborted, true);
    assert.equal(caller.signal.aborted, false);
    assert.equal(await result, "OPERATION_RESULT_UNKNOWN");
    assert.equal(calls, 1);
  } finally {
    deliver(Response.json({ result: true }, { headers: { "Cache-Control": "no-store" } }));
    await result;
  }
});

test("native synchronous transport rejection during cancellation remains classified", async t => {
  const { privateOwnerRequest } = await import("./private-owner-request.ts");
  const caller = new AbortController();
  t.mock.method(globalThis, "fetch", () => {
    caller.abort();
    throw new Error("native synchronous cancellation");
  });
  await assert.rejects(privateOwnerRequest(origin, "/v1/test", bearer, "GET", undefined, caller.signal),
    { code: "OWNER_RESPONSE_STALE" });
});

test("header handoff cannot revive a caller cancelled before delivery", async t => {
  const { fetchOwnerHeaders } = await import("./client-core.ts");
  const caller = new AbortController();
  let cancelled = 0;
  t.mock.method(globalThis, "fetch", () => {
    const pending = Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
    queueMicrotask(() => queueMicrotask(() => caller.abort()));
    return pending;
  });
  await assert.rejects(fetchOwnerHeaders(origin, { signal: caller.signal }), { code: "OWNER_RESPONSE_STALE" });
  assert.equal(cancelled, 1);
});

test("real loopback HTTP header cancellation closes the request and allows recovery", { timeout: 5000 }, async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { privateOwnerRequest } = await import("./private-owner-request.ts");
  const first = Promise.withResolvers();
  const closed = Promise.withResolvers();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (requests === 1) {
      response.once("close", closed.resolve);
      first.resolve();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"recovered":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const caller = new AbortController();
  let watchdog;
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const pending = assert.rejects(privateOwnerRequest(base, "/v1/test", bearer, "GET", undefined, caller.signal),
      { code: "OWNER_RESPONSE_STALE" });
    await first.promise;
    caller.abort();
    await pending;
    const timeout = new Promise(resolve => { watchdog = setTimeout(() => resolve(false), 1500); });
    assert.notEqual(await Promise.race([closed.promise, timeout]), false);
    assert.deepEqual(await privateOwnerRequest(base, "/v1/test", bearer, "GET"), { recovered: true });
    assert.equal(requests, 2);
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("Captain standing accepts only DSH-approved owner record for exact actor", () => {
  const owner = { actorId: "captain-17", status: "APPROVED", version: 2 };
  assert.equal(captainStandingFrom(owner, "captain-17").status, "APPROVED");
  for (const forged of [
    { ...owner, actorId: "someone-else" },
    { ...owner, status: "PENDING" },
    { ...owner, status: "SUSPENDED" },
    { ...owner, version: 0 },
    { ...owner, anotherField: true },
    { ...owner, actorId: "captain-17\n" },
    null,
  ]) assert.throws(() => captainStandingFrom(forged, "captain-17"));
});

const actor = "captain-synthetic";
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
  await expectCode(() => requestCaptainApplication(origin, bearer, actor), "OPERATION_RESULT_UNKNOWN", 0);
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
    await expectCode(() => requestCaptainApplication(origin, bearer, actor), "OPERATION_RESULT_UNKNOWN", failStatus);
  }
  await expectCode(() => readApprovedCaptainStanding(origin, bearer, "customer", actor),
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
    await expectCode(() => requestCaptainApplication(origin, bearer, actor), "OPERATION_RESULT_UNKNOWN", 502);
  }
  response = ownerResponse(standing, 200, { "Cache-Control": "public" });
  await expectCode(() => requestCaptainApplication(origin, bearer, actor), "OPERATION_RESULT_UNKNOWN", 502);
  response = new Response("not-json", { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  await expectCode(() => requestCaptainApplication(origin, bearer, actor), "OPERATION_RESULT_UNKNOWN", 502);
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
  await expectCode(() => requestCaptainApplication(origin, bearer, actor, controller.signal),
    "OPERATION_RESULT_UNKNOWN", 0);
  assert.equal(transportCancelled, true);
  bodyError = true;
  await expectCode(() => requestCaptainApplication(origin, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
});

test("DSH confirmed rejection stays a rejection, confirmed PENDING/APPROVED stays a valid application", async t => {
  let response = ownerResponse();
  t.mock.method(globalThis, "fetch", async () => response);
  response = ownerResponse({ error: "UNAUTHORIZED" }, 401);
  await expectCode(() => requestCaptainApplication(origin, bearer, actor), "UNAUTHORIZED", 401);
  response = ownerResponse({ error: "CAPTAIN_NOT_ELIGIBLE" }, 403);
  await expectCode(() => requestCaptainApplication(origin, bearer, actor), "CAPTAIN_NOT_ELIGIBLE", 403);
  response = ownerResponse();
  assert.equal(await requestCaptainApplication(origin, bearer, actor), "PENDING");
  response = ownerResponse({ ...standing, status: "APPROVED", version: 2 });
  assert.equal(await requestCaptainApplication(origin, bearer, actor), "APPROVED");
});

test("a failing GET does not inherit POST unknown-outcome classification", async t => {
  t.mock.method(globalThis, "fetch", async () => ownerResponse({ ...standing, status: "PENDING" }));
  await expectCode(() => readApprovedCaptainStanding(origin, bearer, "customer", actor),
    "OWNER_RESPONSE_INVALID", 502);
});

test("Customer readback is a no-write, actor-scoped GET and never self-grants Captain", async t => {
  let response = ownerResponse();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response;
  });
  assert.equal(await readCaptainApplication(origin, bearer, actor), "PENDING");
  response = ownerResponse({ ...standing, status: "APPROVED", version: 3 });
  assert.equal(await readCaptainApplication(origin, bearer, actor), "APPROVED");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.pathname === "/v1/actors/me/captain-application" &&
    call.options.method === "GET" && call.options.credentials === "omit"));
  response = ownerResponse({ ...standing, actorId: "different-customer" });
  await expectCode(() => readCaptainApplication(origin, bearer, actor), "OWNER_RESPONSE_INVALID", 502);
  response = ownerResponse({ ...standing, status: "SUSPENDED" });
  await expectCode(() => readCaptainApplication(origin, bearer, actor), "OWNER_RESPONSE_INVALID", 502);
  response = ownerResponse({ error: "CAPTAIN_NOT_ELIGIBLE" }, 403);
  await expectCode(() => readCaptainApplication(origin, bearer, actor), "CAPTAIN_NOT_ELIGIBLE", 403);
});



test("Captain cancellation during response body never turns an uncertain POST into success", async t => {
  const controller = new AbortController();
  abortingReply(t, controller);
  await expectCode(() => requestCaptainApplication(origin, bearer, actor, controller.signal),
    "OPERATION_RESULT_UNKNOWN", 0);
  assert.equal(globalThis.fetch.mock.callCount(), 1, "a stale response must not trigger a second POST");
});

test("Captain cancellation during GET body yields a stale read, never approved access", async t => {
  const controller = new AbortController();
  abortingReply(t, controller);
  await expectCode(() => readApprovedCaptainStanding(origin, bearer, "captain", actor, controller.signal),
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
  await expectCode(() => requestCaptainApplication(origin, bearer, actor),
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
  await expectCode(() => readCaptainApplication(origin, bearer, actor),
    "OWNER_RESPONSE_INVALID", 502);
  assert.equal(textCalled, false, "declared oversize must be rejected before body read");
});

test("Captain Native streaming transport remains available without a global TextEncoder", async t => {
  const valid = ownerResponse();
  t.mock.method(globalThis, "fetch", async () => valid);
  const saved = globalThis.TextEncoder;
  try {
    globalThis.TextEncoder = undefined;
    assert.equal(await requestCaptainApplication(origin, bearer, actor), "PENDING");
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
  await expectCode(() => requestCaptainApplication(origin, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
  assert.equal(consumed, false);
});

test("Captain POST treats invalid streamed UTF-8 as unknown while GET refuses the read", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0xff, 0xfe]), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }));
  await expectCode(() => requestCaptainApplication(origin, bearer, actor),
    "OPERATION_RESULT_UNKNOWN", 502);
  await expectCode(() => readCaptainApplication(origin, bearer, actor),
    "OWNER_RESPONSE_INVALID", 502);
});
