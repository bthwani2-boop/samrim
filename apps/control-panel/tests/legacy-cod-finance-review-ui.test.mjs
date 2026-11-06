import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
  assert.match(ui, /operatorRecoveryStorageKey\(recoveryBaseKey, actorId\)/);
  assert.match(ui, /sessionStorage\.setItem/);
  assert.match(ui, /sessionStorage\.removeItem/);
  assert.match(ui, /readPending\(actorId, paymentId\)/);
  assert.match(ui, /savePending\(actorId, pending\)/);
  assert.doesNotMatch(ui, /X-Acting-Actor-ID/);
  assert.doesNotMatch(ui, /\/wlt\/v1\//);
});
