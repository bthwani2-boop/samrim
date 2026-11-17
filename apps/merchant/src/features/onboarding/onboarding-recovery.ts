export type OnboardingRecoveryReason = "identity" | "store-review" | "authorization";

/** Read-only guidance; never changes onboarding, publication or access state. */
export function onboardingRecoveryMessage(reason: OnboardingRecoveryReason): string {
  switch (reason) {
    case "identity": return "تحقق من جلسة الهوية ثم حاول مجددًا.";
    case "store-review": return "تابع حالة مراجعة المتجر لدى DSH.";
    case "authorization": return "يتطلب المتجر صلاحية موثقة من DSH.";
  }
}
