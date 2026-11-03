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
