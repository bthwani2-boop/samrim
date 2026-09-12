import { identityErrorMessage } from "@bthwani/identity";

export async function responseMessage(response: Response, context: "general" | "login" | "recovery" = "general"): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  switch (code) {
    case "REENROLLMENT_UNSUPPORTED": return "استرداد كلمة مرور موظف لوحة التحكم يتم ذاتيًا عبر مسار استرداد الحساب.";
    case "NOT_FOUND": return "لم يتم العثور على سجل الدور المطلوب.";
    case "DSH_UNAVAILABLE": return "خدمة إدارة الأدوار غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    case "DSH_CONFIG_ERROR": return "إعدادات خدمة إدارة الأدوار غير مكتملة. أعد تشغيل لوحة التحكم المحلية ثم حاول مرة أخرى.";
    default: return identityErrorMessage({ kind: "http", status: response.status, code, message: "" }, context);
  }
}
