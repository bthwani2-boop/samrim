import assert from "node:assert/strict";
import test from "node:test";
import { cashInSimulatorMutationHeaders, cashInSimulatorStateMatches, cashInSimulatorOptions } from "./cash-in-simulator.ts";

test("each simulated outcome is distinct and retry idempotency stays stable", () => {
  const request = { idempotencyKey: "fund-abc", correlationID: "corr-abc" };
  const keys = cashInSimulatorOptions.map(({ outcome }) => {
    const value = cashInSimulatorMutationHeaders(request, outcome);
    assert.deepEqual(cashInSimulatorMutationHeaders(request, outcome), value);
    assert.notEqual(value.idempotencyKey, request.idempotencyKey);
    return value.idempotencyKey;
  });
  assert.equal(new Set(keys).size, 4);
});

test("only canonical settled state confirms successful test funding", () => {
  for (const state of ["PENDING_PROVIDER", "UNKNOWN", "FAILED", "SETTLED"]) {
    assert.equal(cashInSimulatorStateMatches("SUCCESS", state), state === "SETTLED");
    assert.equal(cashInSimulatorStateMatches("FAILURE", state), state === "FAILED");
    assert.equal(cashInSimulatorStateMatches("UNKNOWN", state), state === "UNKNOWN");
    assert.equal(cashInSimulatorStateMatches("DELAYED", state), state === "PENDING_PROVIDER" || state === "UNKNOWN");
  }
});
