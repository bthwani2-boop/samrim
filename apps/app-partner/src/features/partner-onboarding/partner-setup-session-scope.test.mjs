import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerSetupSessionKey } from "./partner-setup-session-scope.ts";

const partner = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "partner", subject, sessionId },
});

test("partner setup is unavailable after logout or for a non-partner role", () => {
  assert.equal(partnerSetupSessionKey({ kind: "signed_out" }), "");
  assert.equal(partnerSetupSessionKey({ kind: "restoring" }), "");
  assert.equal(partnerSetupSessionKey({
    kind: "authenticated", identity: { role: "client", subject: "actor-a", sessionId: "session-1" },
  }), "");
});

test("each actor and each new session has its own wizard identity", () => {
  const original = partnerSetupSessionKey(partner("actor-a", "session-1"));
  assert.notEqual(original, "");
  assert.notEqual(original, partnerSetupSessionKey(partner("actor-b", "session-1")));
  assert.notEqual(original, partnerSetupSessionKey(partner("actor-a", "session-2")));
  assert.equal(original, partnerSetupSessionKey(partner("actor-a", "session-1")));
});

test("structured scope key prevents actor/session delimiter collisions", () => {
  assert.notEqual(
    partnerSetupSessionKey(partner("actor:a", "session")),
    partnerSetupSessionKey(partner("actor", "a:session")),
  );
  assert.equal(partnerSetupSessionKey(partner("", "session")), "");
  assert.equal(partnerSetupSessionKey(partner("actor", "")), "");
});
