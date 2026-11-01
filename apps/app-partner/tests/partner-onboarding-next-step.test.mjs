import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerOnboardingNextStep, nextStoreSetupFocus, storeReadinessProgress } from "../src/features/partner-onboarding/partner-onboarding-next-step.ts";

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
test("store readiness includes unknown authorized steps, without false completion", () => {
  assert.deepEqual(storeReadinessProgress([true, null, false, true]), { total: 4, completed: 2, unknown: 1 });
  assert.deepEqual(storeReadinessProgress([true, null]), { total: 2, completed: 1, unknown: 1 });
  assert.deepEqual(storeReadinessProgress([]), { total: 0, completed: 0, unknown: 0 });
});

test("correction and admission never claim success prematurely", () => {
  assert.match(partnerOnboardingNextStep("needs_correction", false), /استكمال البيانات/);
  assert.match(partnerOnboardingNextStep("submitted", false), /قيد مراجعة/);
  assert.match(partnerOnboardingNextStep("admission_requested", false), /بانتظار/);
});

test("store setup guidance prioritizes consent, catalog and publication without claiming activation", () => {
  const base = {
    ownsStore: true, canEditCatalog: true, canManageAvailability: true,
    publicationState: "hidden", catalogReady: false, agreement: "AWAITING_PARTNER",
    operationalKnown: true, operationalState: "مغلق",
  };
  assert.match(nextStoreSetupFocus(base)?.title ?? "", /الاتفاقية/);
  assert.equal(nextStoreSetupFocus(base)?.href, "/store?section=settings");
  assert.equal(nextStoreSetupFocus({ ...base, agreement: "ACTIVE" })?.href, "/products");
  assert.equal(nextStoreSetupFocus({ ...base, catalogReady: true, agreement: "AWAITING_FINANCE" })?.href, null);
  assert.match(nextStoreSetupFocus({ ...base, catalogReady: true, agreement: "NOT_ACTIVE" })?.title ?? "", /بانتظار/);
  assert.equal(nextStoreSetupFocus({ ...base, catalogReady: true, agreement: "UNAVAILABLE" })?.href, "/store?section=settings");
  assert.equal(nextStoreSetupFocus({ ...base, catalogReady: true, agreement: "ACTIVE" })?.href, "/store?section=settings");
});
test("store setup guidance respects delegated permissions and legitimate closed schedules", () => {
  const base = {
    ownsStore: false, canEditCatalog: true, canManageAvailability: false,
    publicationState: "hidden", catalogReady: false, agreement: null,
    operationalKnown: false, operationalState: "جارٍ التحقق",
  };
  assert.equal(nextStoreSetupFocus(base)?.href, "/products");
  assert.equal(nextStoreSetupFocus({ ...base, catalogReady: true }), null);
  assert.equal(nextStoreSetupFocus({ ...base, canEditCatalog: false }), null);
  const ready = {
    ...base, ownsStore: true, publicationState: "published", catalogReady: true,
    agreement: "ACTIVE", canManageAvailability: true, operationalKnown: true, operationalState: "مغلق",
  };
  assert.equal(nextStoreSetupFocus(ready), null);
  assert.equal(nextStoreSetupFocus({ ...ready, operationalState: "متوقف مؤقتًا" })?.href, "/store?section=operations");
  assert.equal(nextStoreSetupFocus({ ...ready, operationalKnown: false, operationalState: "متوقف مؤقتًا" }), null);
});
