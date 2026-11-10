import assert from "node:assert/strict";
import test from "node:test";
import { captainSessionKey, isCurrentCaptainActor } from "./captain-session-scope.ts";

test("captain readback stays scoped to original authenticated actor", () => {
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a"), true);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-b"), false);
  assert.equal(isCurrentCaptainActor("captain-a", ""), false);
  assert.equal(isCurrentCaptainActor("", "captain-a"), false);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a "), false);
});

test("Captain private Order scope changes for same actor after session renewal", () => {
  const session = (subject, sessionId, role = "captain") =>
    ({ kind: "authenticated", identity: { role, subject, sessionId } });
  const first = captainSessionKey(session("captain-a", "session-a"));
  assert.ok(first);
  assert.notEqual(first, captainSessionKey(session("captain-a", "session-b")));
  assert.notEqual(first, captainSessionKey(session("captain-b", "session-a")));
  assert.equal(first, captainSessionKey(session("captain-a", "session-a")));
  assert.equal(captainSessionKey(session("captain-a", "session-a", "client")), "");
  assert.equal(captainSessionKey(session("captain-a", "")), "");
  assert.equal(captainSessionKey({ kind: "unauthenticated" }), "");
});
