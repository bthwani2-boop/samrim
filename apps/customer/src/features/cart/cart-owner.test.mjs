import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DshCartError, readCurrentCustomerCart, replaceCurrentCustomerCart,
} from "@bthwani/dsh";

const bearer = Buffer.alloc(32, 14).toString("base64url");
const actor = "customer-a";
const store = "store-a";
const origin = "http://127.0.0.1:33222";
const cart = { actorId: actor, storeId: store, version: 2, lines: [{
  offerId: "offer-a", variantId: "variant-a", name: "مقاضي", quantity: 3,
  previewUnitYer: "9007199254740993", previewAvailable: true,
}] };
const operation = {
  operationId: "cart-operation-01", expectedVersion: 1,
  lines: [{ offerId: "offer-a", quantity: 3 }],
};
const success = data => Response.json(data, { headers: { "Cache-Control": "no-store" } });
const signal = () => new AbortController().signal;

test("Customer Cart uses generated DSH owner routes and bearer without cookies or client prices", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: url.toString(), options });
    if (options.method === "PUT") {
      assert.deepEqual(JSON.parse(options.body), operation);
      return success({ cart, replay: false });
    }
    return success(cart);
  });
  assert.deepEqual(await readCurrentCustomerCart(origin, bearer, store, actor, signal()), cart);
  assert.deepEqual(await replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()),
    { cart, replay: false });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method, options.credentials, options.redirect]), [
    [origin + "/v1/carts/store-a", "GET", "omit", "error"],
    [origin + "/v1/carts/store-a", "PUT", "omit", "error"],
  ]);
  assert.ok(calls.every(({ options }) => options.headers.Authorization === "Bearer " + bearer));
});

test("Customer Cart rejects unbound identity, foreign Store and malformed successful owner data", async t => {
  let payload = cart;
  t.mock.method(globalThis, "fetch", async () => success(payload));
  for (payload of [
    { ...cart, actorId: "customer-b" },
    { ...cart, storeId: "store-b" },
    { ...cart, version: -1 },
    { ...cart, lines: [{ ...cart.lines[0], previewUnitYer: "0.5" }] },
    { ...cart, lines: [{ ...cart.lines[0], previewAvailable: "yes" }] },
    { ...cart, lines: [cart.lines[0], cart.lines[0]] },
    { ...cart, lines: [{ ...cart.lines[0], authToken: "unsafe" }] },
  ]) {
    await assert.rejects(readCurrentCustomerCart(origin, bearer, store, actor, signal()),
      { code: "OWNER_RESPONSE_INVALID" });
  }
});

test("Cart mutation never dispatches invalid operation, duplicate Offer or cross-origin input", async t => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => { count++; return success(cart); });
  for (const invalid of [
    { ...operation, lines: [operation.lines[0], operation.lines[0]] },
    { ...operation, operationId: "small" },
    { ...operation, expectedVersion: -1 },
    { ...operation, lines: [{ ...operation.lines[0], quantity: 0 }] },
  ]) {
    await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, invalid, signal()),
      { code: "INVALID_REQUEST" });
  }
  await assert.rejects(readCurrentCustomerCart("http://evil.test", bearer, store, actor, signal()), DshCartError);
  await assert.rejects(readCurrentCustomerCart(origin, bearer, "../store", actor, signal()), DshCartError);
  await assert.rejects(readCurrentCustomerCart(origin, "bad", store, actor, signal()), DshCartError);
  assert.equal(count, 0);
});

test("Unknown Cart mutation results preserve the original key, never manufacture success", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("lost commit acknowledgement"); });
  await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()),
    { code: "OPERATION_RESULT_UNKNOWN" });
  await assert.rejects(readCurrentCustomerCart(origin, bearer, store, actor, signal()),
    { code: "OWNER_NETWORK_UNAVAILABLE" });
  assert.equal(operation.operationId, "cart-operation-01");
});

test("Cart write 503 and malformed 200 are ambiguous; conflicts require readback", async t => {
  let response = new Response("", { status: 503 });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()),
    { code: "OPERATION_RESULT_UNKNOWN" });
  response = new Response(JSON.stringify({ cart: { ...cart, actorId: "other" }, replay: false }),
    { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } });
  await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()),
    { code: "OPERATION_RESULT_UNKNOWN" });
  response = new Response("", { status: 409 });
  await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()),
    { code: "CART_VERSION_OR_OPERATION_CONFLICT" });
});

test("Cart read never consumes an unbounded success envelope", async t => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(32768).fill(0x20)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, {
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  }));
  await assert.rejects(readCurrentCustomerCart(origin, bearer, store, actor, signal()),
    { code: "OWNER_RESPONSE_INVALID" });
  assert.equal(cancelled, true);
});

test("Cart read refuses a response after actor-switch cancellation", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return success(cart);
  });
  await assert.rejects(readCurrentCustomerCart(origin, bearer, store, actor, controller.signal),
    { code: "OWNER_RESPONSE_STALE" });
});


test("Cart write binds the receipt to one exact version and the submitted offer quantities", async t => {
  let payload;
  t.mock.method(globalThis, "fetch", async () => success(payload));
  for (const wrong of [
    { ...cart, version: 3 },
    { ...cart, lines: [] },
    { ...cart, lines: [{ ...cart.lines[0], quantity: 4 }] },
    { ...cart, lines: [{ ...cart.lines[0], offerId: "offer-b" }] },
  ]) {
    payload = { cart: wrong, replay: true };
    await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()), { code: "OPERATION_RESULT_UNKNOWN" });
  }
  payload = { cart, replay: true };
  assert.deepEqual(await replaceCurrentCustomerCart(origin, bearer, store, actor, operation, signal()), payload);
});

test("Cart write snapshots the admitted command before asynchronous owner readback", async t => {
  const command = structuredClone(operation);
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), operation);
    command.expectedVersion = 15;
    command.lines[0].quantity = 4;
    return success({ cart, replay: false });
  });
  assert.deepEqual(await replaceCurrentCustomerCart(origin, bearer, store, actor, command, signal()), { cart, replay: false });
});

test("Cart write refuses sparse, coerced or unrepresentable commands before dispatch", async t => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => { count++; return success({ cart, replay: false }); });
  for (const wrong of [
    { ...operation, lines: Array(1) },
    { ...operation, expectedVersion: Number.MAX_SAFE_INTEGER },
    { ...operation, operationId: 12345678 },
    { ...operation, lines: [{ offerId: 123, quantity: 1 }] },
    { ...operation, lines: [{ ...operation.lines[0], price: "1" }] },
  ]) {
    await assert.rejects(replaceCurrentCustomerCart(origin, bearer, store, actor, wrong, signal()), { code: "INVALID_REQUEST" });
  }
  assert.equal(count, 0);
});
