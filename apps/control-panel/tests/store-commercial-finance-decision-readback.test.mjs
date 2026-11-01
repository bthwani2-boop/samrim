import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../src/features/finance/store-commercial-agreement-workspace.tsx", import.meta.url),
  "utf8",
);
const submitStart = source.indexOf("  async function submitPendingAttempt(");
const verifyStart = source.indexOf("  async function verifyPendingAttempt(");
const beginStart = source.indexOf("  function beginDecision(");

test("finance mutation reply cannot declare success before the separate canonical readback", () => {
  assert.ok(submitStart > 0 && verifyStart > submitStart && beginStart > verifyStart);
  const submit = source.slice(submitStart, verifyStart);
  assert.match(submit, /await readCanonicalFinancialDecision\(attempt\)[\s\S]*finishVerifiedAttempt\(canonical, attempt\)/);
  assert.doesNotMatch(submit, /finishVerifiedAttempt\(body\.agreement/);
  assert.match(submit, /catch \(cause\)[\s\S]*بقيت المحاولة نفسها محفوظة/);
});

test("canonical recovery uses an exact agreement match from an uncached scoped GET", () => {
  const helperStart = source.indexOf("async function readCanonicalFinancialDecision(");
  const workspaceStart = source.indexOf("export function StoreCommercialAgreementWorkspace(");
  assert.ok(helperStart > 0 && workspaceStart > helperStart);
  const helper = source.slice(helperStart, workspaceStart);
  assert.match(helper, /encodeURIComponent\(attempt\.storeId\)/);
  assert.match(helper, /cache: "no-store"/);
  assert.match(helper, /agreement\.agreementId === attempt\.agreementId/);
  assert.match(helper, /matches\.length !== 1/);
  const verify = source.slice(verifyStart, beginStart);
  assert.match(verify, /await readCanonicalFinancialDecision\(attempt\)/);
  assert.match(verify, /finishVerifiedAttempt\(readback, attempt\)/);
});
