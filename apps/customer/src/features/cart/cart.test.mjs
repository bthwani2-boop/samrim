import assert from "node:assert/strict";
import { test } from "node:test";
import { DshCartError } from "@bthwani/dsh";
import * as cartSession from "./cart-session.ts";

const { sameCartScope, pendingCartChange, withPendingCartChange } = cartSession;

test("cart scope does not cross actor, session or Store boundaries", () => {
  const cart = { actorId: "a", sessionId: "1", storeId: "s" };
  assert.equal(sameCartScope(cart, { ...cart }), true);
  for (const change of [{ actorId: "b" }, { sessionId: "2" }, { storeId: "other" }]) {
    assert.equal(sameCartScope(cart, { ...cart, ...change }), false);
  }
  assert.equal(sameCartScope(cart, null), false);
});

test("an unknown add-to-Cart survives navigation and only retries the exact command for that account and Store", async () => {
  const change = {
    operationId: "cart-original-001", expectedVersion: 4,
    lines: [{ offerId: "offer-flour", quantity: 3 }],
  };
  const unknown = new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
  await assert.rejects(withPendingCartChange("customer-a", "store-a", change, async () => { throw unknown; }), unknown);
  assert.equal(pendingCartChange("customer-a", "store-a"), change);
  assert.equal(pendingCartChange("customer-b", "store-a"), undefined);
  assert.equal(pendingCartChange("customer-a", "store-b"), undefined);
  await assert.rejects(withPendingCartChange("customer-a", "store-a",
    { ...change, operationId: "cart-duplicate-001" }, async () => assert.fail("duplicate write dispatched")),
  { code: "CART_PENDING_RECONCILIATION" });
  const replay = await withPendingCartChange("customer-a", "store-a", pendingCartChange("customer-a", "store-a"),
    async payload => { assert.equal(payload, change); return { replay: true }; });
  assert.equal(replay.replay, true);
  assert.equal(pendingCartChange("customer-a", "store-a"), undefined);
});

test("unauthorized retries retain an unknown Cart command while a version conflict releases it for readback", async () => {
  const change = { operationId: "cart-conflict-001", expectedVersion: 3, lines: [] };
  await assert.rejects(withPendingCartChange("customer-a", "store-c", change, async () => {
    throw new DshCartError(401, "UNAUTHORIZED");
  }), { code: "UNAUTHORIZED" });
  assert.equal(pendingCartChange("customer-a", "store-c"), change);
  await assert.rejects(withPendingCartChange("customer-a", "store-c", change, async () => {
    throw new DshCartError(409, "CART_VERSION_OR_OPERATION_CONFLICT");
  }), { code: "CART_VERSION_OR_OPERATION_CONFLICT" });
  assert.equal(pendingCartChange("customer-a", "store-c"), undefined);
});

test("two screens cannot dispatch the same pending Cart change concurrently", async () => {
  const change = { operationId: "cart-in-flight-001", expectedVersion: 0, lines: [] };
  let finish;
  const first = withPendingCartChange("customer-a", "store-d", change,
    () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(withPendingCartChange("customer-a", "store-d", change,
    async () => assert.fail("second write dispatched concurrently")), { code: "CART_PENDING_RECONCILIATION" });
  assert.equal(pendingCartChange("customer-a", "store-d"), change);
  finish({ replay: false });
  assert.deepEqual(await first, { replay: false });
  assert.equal(pendingCartChange("customer-a", "store-d"), undefined);
});
