import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const proposal = readFileSync(new URL("../src/features/partner-onboarding/store-commercial-agreement-proposal.tsx", import.meta.url), "utf8");
const finance = readFileSync(new URL("../src/features/finance/store-commercial-agreement-workspace.tsx", import.meta.url), "utf8");

test("operator sees both commercial models and the non-payment boundary before proposing", () => {
  assert.match(proposal, /aria-label="مقارنة نماذج التعاقد"/);
  assert.match(proposal, /صلاحيات الشريك لا تتغير بحسب النموذج/);
  assert.match(proposal, /الاشتراك غير قابل للتفعيل أو التحصيل حاليًا/);
  assert.match(proposal, /storeCommercialStatusLabel\(item\)/);
  assert.doesNotMatch(proposal, /\{item\.status\}[^\n]*\{item\.commercialModel\}/);
});

test("finance status uses the commercial model and preserves the approval gate", () => {
  assert.match(finance, /import \{ storeCommercialAgreementModes, storeCommercialStatusLabel \}/);
  assert.match(finance, /storeCommercialStatusLabel\(agreement\)/);
  assert.match(finance, /storeCommercialStatusLabel\(selected\)/);
  assert.match(finance, /storeCommercialStatusLabel\(verifiedDecision\.agreement\)/);
  assert.match(finance, /selected\.commercialModel !== "COMMISSION"/);
  assert.match(finance, /<button[^>]*onClick=\{\(\) => beginDecision\("APPROVE"\)\} disabled=\{selected\.commercialModel !== "COMMISSION" \|\|/);
});

test("commercial agreement rereads guard stale responses and preserve the latest Store projection", () => {
  assert.match(proposal, /const readSequence = useRef\(0\)/);
  const readStart = proposal.indexOf("const read = useCallback");
  const readEnd = proposal.indexOf("}, [url, storeId])", readStart);
  assert.ok(readStart >= 0 && readEnd > readStart);
  const read = proposal.slice(readStart, readEnd);
  assert.match(read, /const request = \+\+readSequence\.current/);
  const guard = read.indexOf('if (request !== readSequence.current || signal?.aborted)');
  const write = read.indexOf("setAgreements(items)");
  assert.ok(guard >= 0 && guard < write, "superseded read must be rejected before UI state updates");
  assert.match(read, /catch \(cause\) \{[\s\S]*?request !== readSequence.current/);
  assert.match(proposal, /controller\.abort\(\); readSequence\.current\+\+/);
  assert.match(proposal, /cause\.message === "AGREEMENT_READ_SUPERSEDED"/);
});
