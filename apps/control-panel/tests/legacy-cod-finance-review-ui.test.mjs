import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { operatorPaymentRecoveryStorageKey } from "../src/features/finance/operator-recovery-key.ts";

const root = new URL("../", import.meta.url);
const ui = readFileSync(new URL("src/features/finance/captain-cod-legacy-recovery-workspace.tsx", root), "utf8");
const custody = readFileSync(new URL("src/features/finance/cash-custody-workspace.tsx", root), "utf8");
const submit = readFileSync(new URL("app/api/finance/captain-cod-legacy-reviews/route.ts", root), "utf8");
const approve = readFileSync(new URL("app/api/finance/captain-cod-legacy-reviews/[reviewId]/approve/route.ts", root), "utf8");

test("historical COD review is reachable from the existing Finance cash custody screen", () => {
  assert.match(custody, /<CaptainCODLegacyRecoveryWorkspace key=\{operatorActorId \+ ":" \+ legacyPaymentId\}/);
  assert.match(custody, /setLegacyPaymentId\(item\.paymentIntentId\)/);
  assert.match(ui, /<details/);
  assert.match(ui, /\/api\/finance\/captain-cod-legacy-reviews\/by-payment\//);
  assert.match(ui, /\/api\/finance\/captain-cod-legacy-reviews"/);
  assert.match(ui, /CAPTAIN_COD_LEGACY_RECOVERY/);
});

test("a separate Finance actor must explicitly approve the existing review", () => {
  assert.match(ui, /reviewed\.submittedBy === actorId/);
  assert.match(ui, /reviewed\.submittedBy !== actorId/);
  assert.match(ui, /!approvedConfirmed/);
  assert.match(ui, /type="checkbox"/);
  assert.match(ui, /reviewed\.status !== "PENDING"/);
  assert.match(ui, /\/approve/);
  assert.match(submit, /verifySameOrigin\(request\)/);
  assert.match(approve, /verifySameOrigin\(request\)/);
  for (const route of [submit, approve]) {
    assert.match(route, /identity\.permissions\?\.includes\("finance"\)/);
    assert.match(route, /operatorActorId: identity\.subject/);
  }
});

test("retry keys are scoped to the current operator and never held in cross-actor memory", () => {
  assert.match(ui, /operatorPaymentRecoveryStorageKey\(recoveryBaseKey, actorId, paymentIntentId\)/);
  assert.match(ui, /sessionStorage\.setItem/);
  assert.match(ui, /sessionStorage\.removeItem/);
  assert.match(ui, /readPending\(actorId, paymentId\)/);
  assert.match(ui, /savePending\(actorId, paymentId, pending\)/);
  assert.match(ui, /sessionStorage\.getItem\(legacyKey\)/);
  assert.match(ui, /if \(requestId === serial\.current\) setDocumentId\(pending\.documentId\)/);
  assert.doesNotMatch(ui, /X-Acting-Actor-ID/);
  assert.doesNotMatch(ui, /\/wlt\/v1\//);
});

test("interrupted COD reviews preserve separate retry identities per payment and operator", () => {
  const base = "bthwani.finance.legacy-cod-review.v1";
  const first = operatorPaymentRecoveryStorageKey(base, "finance-a", "payment-a");
  const second = operatorPaymentRecoveryStorageKey(base, "finance-a", "payment-b");
  const otherActor = operatorPaymentRecoveryStorageKey(base, "finance-b", "payment-a");
  assert.ok(first && second && otherActor);
  assert.notEqual(first, second);
  assert.notEqual(first, otherActor);
  assert.notEqual(second, otherActor);
  assert.equal(operatorPaymentRecoveryStorageKey(base, "finance-a", " "), null);
  assert.equal(operatorPaymentRecoveryStorageKey(base, "", "payment-a"), null);
  assert.equal(operatorPaymentRecoveryStorageKey(base, "finance-a", "x".repeat(129)), null);
  const records = new Map([[first, "retry-one"], [second, "retry-two"], [otherActor, "retry-other"]]);
  assert.equal(records.get(first), "retry-one");
  assert.equal(records.get(second), "retry-two");
  assert.equal(records.get(otherActor), "retry-other");
});
