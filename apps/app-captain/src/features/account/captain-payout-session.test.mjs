import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentCaptainActor } from "../captain-operations/captain-session-scope.ts";

const source = readFileSync(new URL("./captain-payout-card.tsx", import.meta.url), "utf8");

test("an actor switch after persistence rejects a former captain's payment request", () => {
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a"), true);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-b"), false);
  assert.equal(isCurrentCaptainActor("captain-a", ""), false);
});

test("payout and finance intake recheck the actor after storing the attempt and before mutating", () => {
  const payout = source.slice(source.indexOf("  const request = async ("), source.indexOf("  const requestIntake = async ("));
  const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));
  for (const [name, code, mutation] of [
    ["payout", payout, "createOwnPayoutIntent("],
    ["intake", intake, "createOwnSettlementIntake("],
  ]) {
    const persisted = code.indexOf("await SecureStore.setItemAsync(");
    const sent = code.indexOf(mutation);
    const checked = code.lastIndexOf("!isCurrentCaptainActor(", sent);
    assert.ok(persisted >= 0 && checked > persisted && sent > checked, `${name} must verify ownership after persistence and before sending`);
  }
});

test("payout rejects identity switches while requesting the access token", () => {
  const payout = source.slice(source.indexOf("  const request = async ("), source.indexOf("  const requestIntake = async ("));
  const actorSnapshot = payout.indexOf("const actorBeforeToken = currentIdentityState();");
  const tokenAcquisition = payout.indexOf("const token = await getUsableIdentityAccessToken();");
  const actorRecheck = payout.indexOf("!isCurrentCaptainActor(actorBeforeToken.identity.subject.trim(), actor.identity.subject.trim())");
  const persist = payout.indexOf("await SecureStore.setItemAsync(");
  assert.ok(actorSnapshot >= 0 && tokenAcquisition > actorSnapshot && actorRecheck > tokenAcquisition && persist > actorRecheck);
});

test("settlement intake preserves its durable retry key and hides readback if the actor changes after mutation", () => {
  const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));
  const mutation = intake.indexOf("await captainClient().createOwnSettlementIntake(");
  const postMutationActorCheck = intake.indexOf("const actorAfterCreate = currentIdentityState();");
  const readback = intake.indexOf("await captainClient().listOwnSettlementIntakes(token)");
  const postReadbackActorCheck = intake.indexOf("const actorAfterReadback = currentIdentityState();");
  const publish = intake.indexOf("setIntake(readback);");
  const clearDurableAttempt = intake.indexOf("await SecureStore.deleteItemAsync(key);");
  assert.ok(mutation >= 0 && postMutationActorCheck > mutation && readback > postMutationActorCheck);
  assert.ok(postReadbackActorCheck > readback && publish > postReadbackActorCheck && clearDurableAttempt > publish);
  assert.match(intake.slice(postMutationActorCheck, readback), /CAPTAIN_INTAKE_SESSION_CHANGED/);
  assert.match(intake.slice(postReadbackActorCheck, publish), /CAPTAIN_INTAKE_SESSION_CHANGED/);
});


test("captain can resume a saved settlement intake without revalidating today's amount or creating a new key", () => {
  const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));
  assert.match(intake, /!pendingIntakeAttempt && \(!state \|\| state\.eligibleAvailableMinor <= 0\)/);
  assert.match(intake, /pendingIntakeAttempt\?\.mode \?\? mode/);
  assert.match(intake, /pendingIntakeAttempt\?\.amountMinor \?\?/);
  assert.match(intake, /if \(!pendingIntakeAttempt && effectiveMode === "SPECIFIED"/);
  assert.match(intake, /const saved = pendingIntakeAttempt \?\?/);
  assert.match(intake, /createOwnSettlementIntake\(token, saved\.mode, saved\.amountMinor, saved\.idempotencyKey, saved\.correlationID\)/);
  assert.match(source, /pendingIntakeAttempt \? <>[\s\S]*?label="التحقق من طلب التسوية المحفوظ"[\s\S]*?requestIntake\(pendingIntakeAttempt\.mode\)/);
});


test("captain refuses to replay an intake when the actor-scoped stored attempt differs", () => {
  const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));
  assert.match(intake, /const raw = await SecureStore\.getItemAsync\(key\)/);
  assert.match(intake, /stored\.idempotencyKey !== pendingIntakeAttempt\.idempotencyKey/);
  assert.match(intake, /stored\.mode !== pendingIntakeAttempt\.mode/);
  assert.match(intake, /CAPTAIN_INTAKE_STORED_ATTEMPT_CHANGED/);
  assert.ok(intake.indexOf("CAPTAIN_INTAKE_STORED_ATTEMPT_CHANGED") < intake.indexOf("createOwnSettlementIntake("));
});
