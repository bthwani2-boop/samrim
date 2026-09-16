import { identityErrorMessage } from "@bthwani/identity";

export async function responseMessage(response: Response, context: "general" | "login" | "recovery" = "general"): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  switch (code) {
    case "REENROLLMENT_UNSUPPORTED": return "إعادة تسجيل المشغل تتطلب تفويضاً محكوماً من مشغل مخول.";
    case "NOT_FOUND": return "لم يتم العثور على سجل الدور المطلوب.";
    case "DSH_UNAVAILABLE": return "خدمة إدارة الأدوار غير متاحة. تحقق من تشغيل الخدمات ثم أعد المحاولة.";
    case "DSH_CONFIG_ERROR": return "إعدادات خدمة إدارة الأدوار غير مكتملة. أعد تشغيل لوحة التحكم المحلية ثم حاول مرة أخرى.";
    case "REFRESH_CONFLICT": return "تجري مزامنة جلسة المشغل من طلب متزامن. أعد المحاولة دون تسجيل الدخول من جديد.";
    case "IDENTITY_SESSION_PERSISTENCE_UNAVAILABLE": return "تعذر حفظ تحديث جلسة المشغل بأمان. أعد المحاولة؛ لم يتم منح وصول غير مثبت.";
    case "IDENTITY_SESSION_RECOVERY_UNKNOWN": return "تعذر تصنيف استرداد جلسة المشغل. أعد المحاولة بعد التحقق من خدمة الهوية.";
    default: return identityErrorMessage({ kind: "http", status: response.status, code, message: "" }, context);
  }
}
