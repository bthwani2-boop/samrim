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
