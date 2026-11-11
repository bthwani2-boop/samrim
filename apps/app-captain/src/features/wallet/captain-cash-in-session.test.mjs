import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const request = source.slice(source.indexOf("  const createIntent = async () => {"), source.indexOf("  const visibleWallet ="));

test("cash-in rejects the same actor after Identity session renewal", () => {
  const identity = (actor, sessionId) => ({
    kind: "authenticated", identity: { role: "captain", subject: actor, sessionId },
  });
  const original = captainSessionKey(identity("captain-a", "login-1"));
  assert.notEqual(original, captainSessionKey(identity("captain-a", "login-2")));
  assert.notEqual(original, captainSessionKey(identity("captain-b", "login-1")));
  assert.equal(captainSessionKey({ kind: "unauthenticated" }), "");
  assert.match(source, /function hasCurrentFundingSession\(sessionKey: string\): boolean \{\s*return Boolean\(sessionKey\) && captainSessionKey\(currentIdentityState\(\)\) === sessionKey/);
});

test("cash-in guards exact session after durable storage and token acquisition before payment", () => {
  const persisted = request.indexOf("await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));");
  const token = request.indexOf("const token = await getUsableIdentityAccessToken();", persisted);
  const mutation = request.indexOf("client.createOwnFundingIntent(", token);
  assert.ok(persisted >= 0 && token > persisted && mutation > token);
  for (const [start, end] of [[persisted, token], [token, mutation]]) {
    assert.match(request.slice(start, end), /if \(!isCurrent\(\)\) throw new Error\("CAPTAIN_CASH_IN_SESSION_CHANGED"\)/);
  }
  assert.match(request, /const requestSession = captainSessionKey\(identity\)/);
  assert.match(request, /const isCurrent = \(\) => hasCurrentFundingSession\(requestSession\)/);
});

test("cash-in protects simulator/reconciliation and retains canonical idempotent retry key", () => {
  const create = request.indexOf("client.createOwnFundingIntent(");
  const confirmed = request.indexOf("await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmed));", create);
  const simulate = request.indexOf("client.simulateOwnFundingIntent(", confirmed);
  const reconcile = request.indexOf("client.reconcileOwnFundingIntent(", simulate);
  const cleared = request.indexOf("await SecureStore.deleteItemAsync(attemptKey(actorID));", reconcile);
  assert.ok(create >= 0 && confirmed > create && simulate > confirmed && reconcile > simulate && cleared > reconcile);
  for (const [start, end] of [[create, confirmed], [confirmed, simulate], [simulate, reconcile], [reconcile, cleared]]) {
    assert.match(request.slice(start, end), /if \(!isCurrent\(\)\) throw new Error\("CAPTAIN_CASH_IN_SESSION_CHANGED"\)/);
  }
  assert.match(request, /fundingInFlight\.current = true/);
  assert.match(request, /fundingInFlight\.current = false/);
  assert.match(request, /if \(isCurrent\(\)\) setBusy\(false\)/);
  assert.match(request, /captain_cashin_\$\{Crypto\.randomUUID\(\)\}/);
});
