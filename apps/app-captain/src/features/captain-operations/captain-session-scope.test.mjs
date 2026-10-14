import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentCaptainActor } from "./captain-session-scope.ts";

test("captain readback stays scoped to original authenticated actor", () => {
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a"), true);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-b"), false);
  assert.equal(isCurrentCaptainActor("captain-a", ""), false);
  assert.equal(isCurrentCaptainActor("", "captain-a"), false);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a "), false);
});
