export type MerchantSessionNotice = "sign-in-required" | "verifying" | "denied";

/** Display guidance only; this is not a session store or authorization mechanism. */
export function merchantSessionMessage(notice: MerchantSessionNotice): string {
  switch (notice) {
    case "sign-in-required": return "يلزم تسجيل الدخول عبر Identity.";
    case "verifying": return "يجب التحقق من صلاحيات المتجر لدى DSH.";
    case "denied": return "لا توجد صلاحية مؤكدة لفتح مساحة المتجر.";
  }
}
