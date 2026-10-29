import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireRepeatOrder,
  createRepeatOrderGate,
  invalidateRepeatOrderForActorChange,
  ownsRepeatOrder,
  releaseRepeatOrder,
} from "./repeat-order-gate.ts";

test("one actor can acquire a repeat action and release it", () => {
  const gate = createRepeatOrderGate();
  const lease = acquireRepeatOrder(gate, "client-a", "order-1");

  assert.deepEqual(lease, { actorID: "client-a", orderID: "order-1" });
  assert.equal(ownsRepeatOrder(gate, lease), true);
  assert.equal(releaseRepeatOrder(gate, lease), true);
  assert.equal(gate.current, null);
});

test("synchronous duplicate invocation for the same actor is rejected", () => {
  const gate = createRepeatOrderGate();

  const first = acquireRepeatOrder(gate, "client-a", "order-1");
  const second = acquireRepeatOrder(gate, "client-a", "order-1");

  assert.ok(first);
  assert.equal(second, null);
});

test("actor change invalidates the previous lease without clearing a newer action", () => {
  const gate = createRepeatOrderGate();
  const previous = acquireRepeatOrder(gate, "client-a", "order-1");
  assert.ok(previous);

  assert.equal(invalidateRepeatOrderForActorChange(gate, "client-b"), previous);
  assert.equal(ownsRepeatOrder(gate, previous), false);
  const current = acquireRepeatOrder(gate, "client-b", "order-2");
  assert.ok(current);

  assert.equal(releaseRepeatOrder(gate, previous), false);
  assert.equal(gate.current, current);
});
