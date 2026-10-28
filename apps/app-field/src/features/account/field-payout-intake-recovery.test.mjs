import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./field-payout-card.tsx", import.meta.url), "utf8");
const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));

test("field settlement retry reuses the original mode, amount and idempotency key", () => {
  assert.match(intake, /!pendingIntakeAttempt && \(!state \|\| state\.eligibleAvailableMinor <= 0\)/);
  assert.match(intake, /pendingIntakeAttempt\?\.mode \?\? mode/);
  assert.match(intake, /pendingIntakeAttempt\?\.amountMinor \?\?/);
  assert.match(intake, /if \(!pendingIntakeAttempt && effectiveMode === "SPECIFIED"/);
  assert.match(intake, /const saved = pendingIntakeAttempt \?\?/);
  assert.match(intake, /createOwnSettlementIntake\(token, saved\.mode, saved\.amountMinor, saved\.idempotencyKey, saved\.correlationID\)/);
  assert.match(source, /else if \(pendingIntakeAttempt\)[\s\S]*?label="التحقق من طلب التسوية المحفوظ"[\s\S]*?requestIntake\(pendingIntakeAttempt\.mode\)/);
});

test("field settlement retry rejects actor switches and cross-actor readback before clearing the durable key", () => {
  const persisted = intake.indexOf("await SecureStore.setItemAsync(key, JSON.stringify(saved))");
  const beforeSend = intake.indexOf("const actorBeforeSend = currentIdentityState()");
  const mutation = intake.indexOf("await fieldClient().createOwnSettlementIntake(");
  const afterCreate = intake.indexOf("const actorAfterCreate = currentIdentityState()");
  const readback = intake.indexOf("await fieldClient().listOwnSettlementIntakes(token)");
  const afterReadback = intake.indexOf("const actorAfterReadback = currentIdentityState()");
  const publish = intake.indexOf("setIntake(readback)");
  const cleared = intake.indexOf("await SecureStore.deleteItemAsync(key)");
  assert.ok(persisted >= 0 && beforeSend > persisted && mutation > beforeSend && afterCreate > mutation);
  assert.ok(readback > afterCreate && afterReadback > readback && publish > afterReadback && cleared > publish);
  assert.match(intake, /readback\?\.actorType !== "field" \|\| readback\.actorId !== actor\.identity\.subject/);
  assert.match(intake, /created\.intake\.actorType !== "field" \|\| created\.intake\.actorId !== actor\.identity\.subject/);
});


test("field payout and intake share one synchronous financial submission lock", () => {
  const payout = source.slice(source.indexOf("  const request = async ("), source.indexOf("  const requestIntake = async ("));
  for (const [name, body] of [["payout", payout], ["intake", intake]]) {
    const acquire = body.indexOf("if (financialRequestInFlight.current) return;");
    const mark = body.indexOf("financialRequestInFlight.current = true;");
    const mutation = body.indexOf(name === "payout" ? "createOwnPayoutIntent(" : "createOwnSettlementIntake(");
    const release = body.indexOf("financialRequestInFlight.current = false;");
    assert.ok(acquire >= 0 && mark > acquire && mutation > mark && release > mutation, `${name} must acquire and release the same lock`);
  }
});


test("field refuses to replay an intake when the actor-scoped stored attempt differs", () => {
  assert.match(intake, /const raw = await SecureStore\.getItemAsync\(key\)/);
  assert.match(intake, /stored\.idempotencyKey !== pendingIntakeAttempt\.idempotencyKey/);
  assert.match(intake, /stored\.mode !== pendingIntakeAttempt\.mode/);
  assert.match(intake, /FIELD_INTAKE_STORED_ATTEMPT_CHANGED/);
  assert.ok(intake.indexOf("FIELD_INTAKE_STORED_ATTEMPT_CHANGED") < intake.indexOf("createOwnSettlementIntake("));
});
