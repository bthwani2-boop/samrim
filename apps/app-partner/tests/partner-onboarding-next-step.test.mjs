import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerOnboardingNextStep } from "../src/features/partner-onboarding/partner-onboarding-next-step.ts";

test("all joining-case stages explain a safe actionable next step", () => {
  for (const state of ["draft", "admission_requested", "submitted", "needs_correction", "approved"]) {
    const guidance = partnerOnboardingNextStep(state, true);
    assert.ok(guidance.length >= 28, state);
    assert.equal(guidance.includes("عمولتك 0%"), false, state);
  }
});
test("approved without Store does not claim it is ready or published", () => {
  assert.match(partnerOnboardingNextStep("approved", false), /لم يظهر/);
  assert.match(partnerOnboardingNextStep("approved", true), /جهّز الكتالوج/);
});
test("correction and admission never claim success prematurely", () => {
  assert.match(partnerOnboardingNextStep("needs_correction", false), /استكمال البيانات/);
  assert.match(partnerOnboardingNextStep("submitted", false), /قيد مراجعة/);
  assert.match(partnerOnboardingNextStep("admission_requested", false), /بانتظار/);
});
