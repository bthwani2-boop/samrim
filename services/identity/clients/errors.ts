import { isIdentityClientError } from "./client";

export type IdentityErrorContext = "general" | "login" | "recovery";

const genericMessage = "تعذر إكمال العملية. تحقق من البيانات ثم حاول مرة أخرى.";

export function identityErrorMessage(value: unknown, context: IdentityErrorContext = "general"): string {
  if (!isIdentityClientError(value)) return genericMessage;
  if (value.kind === "network" || (value.kind === "http" && value.status >= 500)) {
    return "تعذر الاتصال بخدمة الهوية. تحقق من الاتصال ثم أعد المحاولة.";
  }

  if (value.kind !== "http") return genericMessage;

  switch (value.code) {
    case "RATE_LIMITED":
      return "تم تجاوز عدد المحاولات المسموح. انتظر قليلًا ثم حاول مرة أخرى.";
    case "REFRESH_STALE":
      return "انتهت صلاحية الجلسة الحالية. سجّل الدخول مرة أخرى.";
    case "FORBIDDEN":
      return "هذا الحساب أو الإجراء غير مسموح به حاليًا.";
    case "UNAUTHENTICATED":
      if (context === "login") return "رقم الهاتف أو كلمة المرور غير صحيحة.";
      if (context === "recovery") return "رمز التحقق أو البيانات الجديدة غير صحيحة.";
      return "تعذر التحقق من بيانات الهوية.";
    case "CONFLICT":
      return "تغيرت حالة الحساب. حدّث البيانات ثم حاول مرة أخرى.";
    case "INVALID_INPUT":
    case "INVALID_REQUEST":
      return context === "login" ? "تحقق من رقم الهاتف وكلمة المرور." : genericMessage;
    default:
      return genericMessage;
  }
}
