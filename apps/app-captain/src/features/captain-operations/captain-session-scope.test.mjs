import assert from "node:assert/strict";
import test from "node:test";
import { canPublishCaptainLocation, isCurrentCaptainActor } from "./captain-session-scope.ts";

test("captain readback stays scoped to original authenticated actor", () => {
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a"), true);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-b"), false);
  assert.equal(isCurrentCaptainActor("captain-a", ""), false);
  assert.equal(isCurrentCaptainActor("", "captain-a"), false);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a "), false);
});

test("GPS updates stop unless the authenticated owner holds a selected assignment", () => {
  assert.equal(canPublishCaptainLocation("captain-a", "captain-a", "assignment-1"), true);
  assert.equal(canPublishCaptainLocation("captain-a", "captain-b", "assignment-1"), false);
  assert.equal(canPublishCaptainLocation("captain-a", "", "assignment-1"), false);
  assert.equal(canPublishCaptainLocation("captain-a", "captain-a", ""), false);
});
