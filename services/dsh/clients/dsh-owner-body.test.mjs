import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedOwnerJSON } from "./client-core.ts";

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
