import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isCurrentCaptainActor } from "../captain-operations/captain-session-scope.ts";

const source = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const request = source.slice(source.indexOf("  const createIntent = async () => {"), source.indexOf("  const state = wallet?.state;"));

test("funding actor scope rejects a different or signed-out actor", () => {
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a"), true);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-b"), false);
  assert.equal(isCurrentCaptainActor("captain-a", ""), false);
});

test("cash-in checks the actor after durable storage and token acquisition before provider mutation", () => {
  const persisted = request.indexOf("await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));");
  const token = request.indexOf("const token = await getUsableIdentityAccessToken();", persisted);
  const created = request.indexOf("client.createOwnFundingIntent(", token);
  assert.ok(persisted >= 0 && token > persisted && created > token);
  assert.match(request.slice(persisted, token), /if \(!hasCurrentFundingActor\(actorID\)\) throw new Error\("CAPTAIN_CASH_IN_SESSION_CHANGED"\)/);
  assert.match(request.slice(token, created), /if \(!hasCurrentFundingActor\(actorID\)\) throw new Error\("CAPTAIN_CASH_IN_SESSION_CHANGED"\)/);
});

test("cash-in rechecks owner before simulator/reconciliation and preserves the same durable retry key", () => {
  const create = request.indexOf("client.createOwnFundingIntent(");
  const confirmed = request.indexOf("await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmed));", create);
  const simulate = request.indexOf("client.simulateOwnFundingIntent(", confirmed);
  const reconcile = request.indexOf("client.reconcileOwnFundingIntent(", simulate);
  const cleared = request.indexOf("await SecureStore.deleteItemAsync(attemptKey(actorID));", reconcile);
  assert.ok(create >= 0 && confirmed > create && simulate > confirmed && reconcile > simulate && cleared > reconcile);
  for (const [start, end] of [[create, confirmed], [confirmed, simulate], [simulate, reconcile], [reconcile, cleared]]) {
    assert.match(request.slice(start, end), /hasCurrentFundingActor\(actorID\)/);
  }
  assert.match(request, /fundingInFlight\.current = true;/);
  assert.match(request, /finally \{ fundingInFlight\.current = false; setBusy\(false\); \}/);
  assert.match(request, /idempotencyKey: `captain_cashin_\$\{Crypto\.randomUUID\(\)\}`/);
});
