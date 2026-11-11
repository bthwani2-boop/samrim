import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireRepeatOrder,
  createRepeatOrderGate,
  invalidateRepeatOrderForSessionChange,
  ownsRepeatOrder,
  releaseRepeatOrder,
} from "./repeat-order-gate.ts";

test("one session can acquire a repeat action and release it", () => {
  const gate = createRepeatOrderGate();
  const lease = acquireRepeatOrder(gate, "client-a", "order-1");

  assert.deepEqual(lease, { sessionKey: "client-a", orderID: "order-1" });
  assert.equal(ownsRepeatOrder(gate, lease), true);
  assert.equal(releaseRepeatOrder(gate, lease), true);
  assert.equal(gate.current, null);
});

test("synchronous duplicate invocation for the same session is rejected", () => {
  const gate = createRepeatOrderGate();

  const first = acquireRepeatOrder(gate, "client-a", "order-1");
  const second = acquireRepeatOrder(gate, "client-a", "order-1");

  assert.ok(first);
  assert.equal(second, null);
});

test("session change invalidates the previous lease without clearing a newer action", () => {
  const gate = createRepeatOrderGate();
  const previous = acquireRepeatOrder(gate, "client-a", "order-1");
  assert.ok(previous);

  assert.equal(invalidateRepeatOrderForSessionChange(gate, "client-b"), previous);
  assert.equal(ownsRepeatOrder(gate, previous), false);
  const current = acquireRepeatOrder(gate, "client-b", "order-2");
  assert.ok(current);

  assert.equal(releaseRepeatOrder(gate, previous), false);
  assert.equal(gate.current, current);
});


test("same customer reauthentication invalidates in-flight repeat without clearing newer session", () => {
  const gate = createRepeatOrderGate();
  const former = acquireRepeatOrder(gate, '["customer-a","session-1"]', "order-1");
  assert.ok(former);
  const currentSession = '["customer-a","session-2"]';
  assert.equal(invalidateRepeatOrderForSessionChange(gate, currentSession), former);
  assert.equal(ownsRepeatOrder(gate, former), false);
  const current = acquireRepeatOrder(gate, currentSession, "order-1");
  assert.ok(current);
  assert.equal(invalidateRepeatOrderForSessionChange(gate, currentSession), null);
  assert.equal(gate.current, current);
  assert.equal(releaseRepeatOrder(gate, former), false);
});
