import assert from "node:assert/strict";
import test from "node:test";
import { clientSessionKey } from "./client-session-scope.ts";

test("Client Identity session scope changes on same-actor reauthentication and rejects non-client sessions", () => {
  const state = (subject, sessionId, role = "client") => ({ kind: "authenticated", identity: { role, subject, sessionId } });
  const first = clientSessionKey(state("customer-a", "session-a"));
  const renewed = clientSessionKey(state("customer-a", "session-b"));
  const other = clientSessionKey(state("customer-b", "session-a"));
  assert.ok(first);
  assert.notEqual(first, renewed);
  assert.notEqual(first, other);
  assert.equal(clientSessionKey(state("customer-a", "session-a", "partner")), "");
  assert.equal(clientSessionKey(state("customer-a", "")), "");
  assert.equal(clientSessionKey({ kind: "unauthenticated" }), "");
  assert.notEqual(clientSessionKey(state("actor:a", "session:b")), clientSessionKey(state("actor", "a:session:b")));
});
