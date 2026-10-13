import assert from "node:assert/strict";
import test from "node:test";

import { canActOnCaptainTask } from "./captain-task-eligibility.ts";

const assigned = { id: "assignment-1", state: "assigned", handoff: { state: "store_confirmed" } };
const custody = { id: "assignment-1", state: "in_custody", handoff: { state: "completed" } };

test("missing task blocks custody and completion", () => {
  assert.equal(canActOnCaptainTask(assigned, undefined), false);
  assert.equal(canActOnCaptainTask(custody, undefined), false);
});

test("wrong assignment, stale delivery, or stale handoff blocks mutation", () => {
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-2", deliveryState: "assigned", handoffState: "store_confirmed" }), false);
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-1", deliveryState: "in_custody", handoffState: "store_confirmed" }), false);
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-1", deliveryState: "assigned", handoffState: "pending" }), false);
  assert.equal(canActOnCaptainTask(custody, { assignmentId: "assignment-1", deliveryState: "assigned", handoffState: "completed" }), false);
});

test("matching owner-backed task admits current actions", () => {
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-1", deliveryState: "assigned", handoffState: "store_confirmed" }), true);
  assert.equal(canActOnCaptainTask(custody, { assignmentId: "assignment-1", deliveryState: "in_custody", handoffState: "completed" }), true);
});
