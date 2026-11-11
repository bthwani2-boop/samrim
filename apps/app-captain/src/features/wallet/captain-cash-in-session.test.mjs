import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const request = source.slice(source.indexOf("  const createIntent = async () => {"), source.indexOf("  const visibleWallet ="));

// Execute the Cash-In screen's actual recovery validators rather than a copy.
const cashAst = ts.createSourceFile("cash-in-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const recoveryNames = ["parseCaptainFundingAttempt", "matchesCaptainFundingRequest", "matchesCaptainFundingAttempt"];
const recoverySources = recoveryNames.map((name) => {
  const declaration = cashAst.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Cash-In owner is missing ${name}`);
  return declaration.getText(cashAst);
});
const recoveryJs = ts.transpileModule(
  `${recoverySources.join("\n")}\n({parseCaptainFundingAttempt, matchesCaptainFundingRequest, matchesCaptainFundingAttempt})`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const { parseCaptainFundingAttempt, matchesCaptainFundingRequest, matchesCaptainFundingAttempt } = runInNewContext(recoveryJs);
const validAttempt = Object.freeze({
  version: 1, actorID: "captain-a", amountMinor: 1000,
  idempotencyKey: "captain_retry_key", correlationID: "captain_corr_key",
  fundingIntentID: "intent-a", providerKey: "provider-a",
});
const validIntent = Object.freeze({
  id: "intent-a", actorType: "captain", actorId: "captain-a",
  fundingPurpose: "CAPTAIN_TOPUP", amountMinor: 1000, currency: "YER",
  providerKey: "PROVIDER-A",
});

test("Cash-In production recovery accepts only a complete actor-owned durable attempt", () => {
  assert.equal(parseCaptainFundingAttempt(null, "captain-a"), null);
  const restored = parseCaptainFundingAttempt(JSON.stringify(validAttempt), "captain-a");
  assert.equal(restored.idempotencyKey, validAttempt.idempotencyKey);
  assert.equal(restored.correlationID, validAttempt.correlationID);
  assert.equal(matchesCaptainFundingAttempt(validIntent, restored), true);
  assert.equal(matchesCaptainFundingRequest(validIntent, "captain-a", 1000), true);
});

test("Cash-In invalid and foreign persisted attempts fail closed", () => {
  for (const raw of [
    "null", "[]", "{",
    JSON.stringify({ ...validAttempt, actorID: "captain-b" }),
    JSON.stringify({ ...validAttempt, version: 2 }),
    JSON.stringify({ ...validAttempt, amountMinor: 0 }),
    JSON.stringify({ ...validAttempt, amountMinor: 1.5 }),
    JSON.stringify({ ...validAttempt, fundingIntentID: "" }),
    JSON.stringify({ ...validAttempt, idempotencyKey: "short" }),
    JSON.stringify({ ...validAttempt, correlationID: "short" }),
    JSON.stringify({ ...validAttempt, providerKey: 42 }),
    JSON.stringify({ ...validAttempt, providerKey: "" }),
  ]) {
    assert.throws(() => parseCaptainFundingAttempt(raw, "captain-a"));
  }
  assert.throws(() => parseCaptainFundingAttempt(JSON.stringify(validAttempt), "captain-b"));
});

test("Cash-In canonical funding intent must match Captain, purpose, amount, currency and provider", () => {
  assert.equal(matchesCaptainFundingAttempt(validIntent, { ...validAttempt, fundingIntentID: undefined }), false);
  for (const intent of [
    { ...validIntent, id: "intent-b" },
    { ...validIntent, id: undefined },
    { ...validIntent, actorType: "merchant" },
    { ...validIntent, actorId: "captain-b" },
    { ...validIntent, fundingPurpose: "CUSTOMER_TOPUP" },
    { ...validIntent, amountMinor: 2000 },
    { ...validIntent, currency: "USD" },
    { ...validIntent, providerKey: "OTHER" },
  ]) {
    assert.equal(matchesCaptainFundingAttempt(intent, validAttempt), false);
  }
});

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
