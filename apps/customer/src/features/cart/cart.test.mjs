import assert from "node:assert/strict";
import { test } from "node:test";
import { DshCartError } from "@bthwani/dsh";
import * as cartSession from "./cart-session.ts";

const { pendingCartChange, withPendingCartChange } = cartSession;

test("an unknown add-to-Cart survives navigation and only retries the exact command for that account and Store", async () => {
  const change = {
    operationId: "cart-original-001", expectedVersion: 4,
    lines: [{ offerId: "offer-flour", quantity: 3 }],
  };
  const unknown = new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
  await assert.rejects(withPendingCartChange("customer-a", "store-a", change, async () => { throw unknown; }), unknown);
  assert.deepEqual(pendingCartChange("customer-a", "store-a"), change);
  assert.equal(pendingCartChange("customer-b", "store-a"), undefined);
  assert.equal(pendingCartChange("customer-a", "store-b"), undefined);
  await assert.rejects(withPendingCartChange("customer-a", "store-a",
    { ...change, operationId: "cart-duplicate-001" }, async () => assert.fail("duplicate write dispatched")),
  { code: "CART_PENDING_RECONCILIATION" });
  const replay = await withPendingCartChange("customer-a", "store-a", pendingCartChange("customer-a", "store-a"),
    async payload => { assert.deepEqual(payload, change); return { replay: true }; });
  assert.equal(replay.replay, true);
  assert.equal(pendingCartChange("customer-a", "store-a"), undefined);
});

test("unauthorized retries retain an unknown Cart command while a version conflict releases it for readback", async () => {
  const change = { operationId: "cart-conflict-001", expectedVersion: 3, lines: [] };
  await assert.rejects(withPendingCartChange("customer-a", "store-c", change, async () => {
    throw new DshCartError(401, "UNAUTHORIZED");
  }), { code: "UNAUTHORIZED" });
  assert.deepEqual(pendingCartChange("customer-a", "store-c"), change);
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
  assert.deepEqual(pendingCartChange("customer-a", "store-d"), change);
  finish({ replay: false });
  assert.deepEqual(await first, { replay: false });
  assert.equal(pendingCartChange("customer-a", "store-d"), undefined);
});

test("unknown command keeps its original payload after caller mutates every nested field", async () => {
  const input = { operationId: "cart-original-mutable", expectedVersion: 4, lines: [{ offerId: "offer-flour", quantity: 3 }] };
  const original = structuredClone(input);
  const unknown = new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
  await assert.rejects(withPendingCartChange("customer-mutable", "store-a", input, async () => { throw unknown; }), unknown);
  input.operationId = "cart-replaced-mutable";
  input.expectedVersion = 5;
  input.lines[0].quantity = 99;
  input.lines.push({ offerId: "offer-other", quantity: 1 });
  assert.deepEqual(pendingCartChange("customer-mutable", "store-a"), original);
  await assert.rejects(withPendingCartChange("customer-mutable", "store-a", input, async () => assert.fail("mutated write dispatched")), { code: "CART_PENDING_RECONCILIATION" });
  await withPendingCartChange("customer-mutable", "store-a", original, async payload => { assert.deepEqual(payload, original); });
  assert.equal(pendingCartChange("customer-mutable", "store-a"), undefined);
});

test("pending command cannot be mutated through the readback or the send callback", async () => {
  const input = { operationId: "cart-exposed-mutable", expectedVersion: 4, lines: [{ offerId: "offer-flour", quantity: 3 }] };
  const original = structuredClone(input);
  const unknown = new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
  await assert.rejects(withPendingCartChange("customer-exposed", "store-a", input, async payload => {
    assert.ok(Object.isFrozen(payload));
    assert.ok(Object.isFrozen(payload.lines));
    assert.ok(Object.isFrozen(payload.lines[0]));
    throw unknown;
  }), unknown);
  const retained = pendingCartChange("customer-exposed", "store-a");
  assert.throws(() => { retained.lines[0].quantity = 5; }, TypeError);
  assert.deepEqual(retained, original);
  await withPendingCartChange("customer-exposed", "store-a", retained, async payload => assert.deepEqual(payload, original));
});

test("retry matching checks the complete command and keeps the retained command on any mismatch", async () => {
  const original = { operationId: "cart-exact-snapshot", expectedVersion: 3, lines: [{ offerId: "offer-a", quantity: 2 }] };
  const unknown = new DshCartError(503, "OPERATION_RESULT_UNKNOWN");
  await assert.rejects(withPendingCartChange("customer-exact", "store-a", original, async () => { throw unknown; }), unknown);
  for (const proposal of [
    { ...original, expectedVersion: 4 },
    { ...original, lines: [] },
    { ...original, lines: [{ offerId: "offer-b", quantity: 2 }] },
    { ...original, lines: [{ offerId: "offer-a", quantity: 3 }] },
    { ...original, lines: new Array(1) },
  ]) {
    await assert.rejects(withPendingCartChange("customer-exact", "store-a", proposal, async () => assert.fail("different payload dispatched")), { code: "CART_PENDING_RECONCILIATION" });
    assert.deepEqual(pendingCartChange("customer-exact", "store-a"), original);
  }
  await withPendingCartChange("customer-exact", "store-a", structuredClone(original), async payload => assert.deepEqual(payload, original));
  assert.equal(pendingCartChange("customer-exact", "store-a"), undefined);
});
