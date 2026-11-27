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
