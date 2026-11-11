import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./captain-payout-card.tsx", import.meta.url), "utf8");
const request = source.slice(source.indexOf("  const request = async ("), source.indexOf("  const requestIntake = async ("));
const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));

test("financial read and mutation require the exact Captain Identity session", () => {
  const session = (actor, id) => ({ kind: "authenticated", identity: { role: "captain", subject: actor, sessionId: id } });
  const old = captainSessionKey(session("captain-a", "session-1"));
  assert.ok(old);
  assert.notEqual(old, captainSessionKey(session("captain-a", "session-2")));
  assert.notEqual(old, captainSessionKey(session("captain-b", "session-1")));
  assert.match(source, /function hasCurrentPayoutSession\(sessionKey: string\): boolean \{\s*return Boolean\(sessionKey\) && captainSessionKey\(currentIdentityState\(\)\) === sessionKey/);
  assert.doesNotMatch(source, /isCurrentCaptainActor/);
});

test("payout and intake recheck exact Identity session after persistence before financial mutation", () => {
  for (const [name, code, mutation] of [
    ["payout", request, "createOwnPayoutIntent("],
    ["intake", intake, "createOwnSettlementIntake("],
  ]) {
    const persist = code.indexOf("await SecureStore.setItemAsync(");
    const send = code.indexOf(mutation);
    const gate = code.lastIndexOf("if (!hasCurrentPayoutSession(requestSession))", send);
    assert.ok(persist >= 0 && gate > persist && send > gate, name);
  }
});

test("payout rejects token requests from a renewed session and preserves actor retry", () => {
  const snapshot = request.indexOf("const actorBeforeToken = currentIdentityState();");
  const token = request.indexOf("const token = await getUsableIdentityAccessToken();");
  const check = request.indexOf("captainSessionKey(actor) !== requestSession", token);
  const saved = request.indexOf("await SecureStore.setItemAsync(");
  assert.ok(snapshot >= 0 && token > snapshot && check > token && saved > check);
  assert.match(request, /bthwani\.captain\.payout\.pending\.v1\.\$\{encodeURIComponent\(actor\.identity\.subject\)\}/);
});

test("intake keeps durable retry and prevents stale post-mutation readback", () => {
  const mutation = intake.indexOf("await captainClient().createOwnSettlementIntake(");
  const guardAfterMutation = intake.indexOf("if (!hasCurrentPayoutSession(requestSession))", mutation);
  const readback = intake.indexOf("await captainClient().listOwnSettlementIntakes(token)");
  const guardAfterReadback = intake.indexOf("if (!hasCurrentPayoutSession(requestSession))", readback);
  const publish = intake.indexOf("setIntake(readback);");
  const clearDurable = intake.indexOf("await SecureStore.deleteItemAsync(key);", publish);
  assert.ok(mutation >= 0 && guardAfterMutation > mutation && readback > guardAfterMutation);
  assert.ok(guardAfterReadback > readback && publish > guardAfterReadback && clearDurable > publish);
  assert.match(intake.slice(mutation, publish), /CAPTAIN_INTAKE_SESSION_CHANGED/);
  assert.match(intake, /bthwani\.captain\.settlement-intake\.pending\.v1\.\$\{encodeURIComponent\(actor\.identity\.subject\)\}/);
});

test("saved settlement intake resumes with its old idempotency key, not a new quote", () => {
  assert.match(intake, /!pendingIntakeAttempt && \(!state \|\| state\.eligibleAvailableMinor <= 0\)/);
  assert.match(intake, /pendingIntakeAttempt\?\.mode \?\? mode/);
  assert.match(intake, /pendingIntakeAttempt\?\.amountMinor \?\?/);
  assert.match(intake, /if \(!pendingIntakeAttempt && effectiveMode === "SPECIFIED"/);
  assert.match(intake, /const saved = pendingIntakeAttempt \?\?/);
  assert.match(intake, /createOwnSettlementIntake\(token, saved\.mode, saved\.amountMinor, saved\.idempotencyKey, saved\.correlationID\)/);
  assert.match(source, /pendingIntakeAttempt \? <>[\s\S]*?label="التحقق من طلب التسوية المحفوظ"[\s\S]*?requestIntake\(pendingIntakeAttempt\.mode\)/);
});

test("intake rejects changed actor-scoped stored attempt before financial mutation", () => {
  assert.match(intake, /const raw = await SecureStore\.getItemAsync\(key\)/);
  assert.match(intake, /stored\.idempotencyKey !== pendingIntakeAttempt\.idempotencyKey/);
  assert.match(intake, /stored\.mode !== pendingIntakeAttempt\.mode/);
  assert.match(intake, /CAPTAIN_INTAKE_STORED_ATTEMPT_CHANGED/);
  assert.ok(intake.indexOf("CAPTAIN_INTAKE_STORED_ATTEMPT_CHANGED") < intake.indexOf("createOwnSettlementIntake("));
});
