import assert from "node:assert/strict";
import { test } from "node:test";

import { isConfirmedCaptainCompletion } from "./captain-completion-readback.ts";

const attempt = Object.freeze({
  actorID: "captain-a",
  assignmentID: "assignment-a",
  expectedVersion: 4,
  request: { result: "delivered" },
});
const reply = Object.freeze({
  assignment: {
    id: "assignment-a",
    captainActorId: "captain-a",
    state: "delivered",
    terminalResult: "delivered",
    terminalAt: "2026-11-01T01:00:00Z",
    version: 5,
  },
  idempotentReplay: false,
});

test("canonical terminal completion matches the same Captain, assignment and version", () => {
  assert.equal(isConfirmedCaptainCompletion(reply, attempt), true);
  assert.equal(isConfirmedCaptainCompletion({ ...reply, idempotentReplay: true }, attempt), true);
  assert.equal(isConfirmedCaptainCompletion({
    ...reply,
    assignment: { ...reply.assignment, state: "delivery_failed", terminalResult: "delivery_failed" },
  }, { ...attempt, request: { result: "delivery_failed" } }), true);
});

test("mismatched or incomplete response never clears a pending terminal attempt", () => {
  assert.equal(isConfirmedCaptainCompletion(null, attempt), false);
  for (const assignment of [
    { ...reply.assignment, id: "assignment-b" },
    { ...reply.assignment, captainActorId: "captain-b" },
    { ...reply.assignment, state: "in_custody" },
    { ...reply.assignment, terminalResult: "delivery_failed" },
    { ...reply.assignment, version: 4 },
    { ...reply.assignment, version: 3 },
    { ...reply.assignment, terminalAt: null },
    { ...reply.assignment, terminalAt: "" },
  ]) assert.equal(isConfirmedCaptainCompletion({ ...reply, assignment }, attempt), false);
});
