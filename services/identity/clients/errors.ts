import { isIdentityClientError } from "./client";

export type IdentityErrorContext = "general" | "login" | "recovery";

export type IdentityErrorMessages = {
  generic: string;
  network: string;
  rateLimited: string;
  refreshStale: string;
  forbidden: string;
  unauthenticated: Record<IdentityErrorContext, string>;
  conflict: string;
  invalidLogin: string;
};

const defaultMessages: IdentityErrorMessages = {
  generic: "تعذر إكمال العملية. تحقق من البيانات ثم حاول مرة أخرى.",
  network: "تعذر الاتصال بخدمة الهوية. تحقق من الاتصال ثم أعد المحاولة.",
  rateLimited: "تم تجاوز عدد المحاولات المسموح. انتظر قليلًا ثم حاول مرة أخرى.",
  refreshStale: "انتهت صلاحية الجلسة الحالية. سجّل الدخول مرة أخرى.",
  forbidden: "هذا الحساب أو الإجراء غير مسموح به حاليًا.",
  unauthenticated: {
    general: "تعذر التحقق من بيانات الهوية.",
    login: "رقم الهاتف أو كلمة المرور غير صحيحة.",
    recovery: "رمز التحقق أو البيانات الجديدة غير صحيحة.",
  },
  conflict: "تغيرت حالة الحساب. حدّث البيانات ثم حاول مرة أخرى.",
  invalidLogin: "تحقق من رقم الهاتف وكلمة المرور.",
};

export function identityErrorMessage(
  value: unknown,
  context: IdentityErrorContext = "general",
  messages: IdentityErrorMessages = defaultMessages,
): string {
  if (!isIdentityClientError(value)) return messages.generic;
  if (value.kind === "network" || (value.kind === "http" && value.status >= 500)) {
    return messages.network;
  }

  if (value.kind !== "http") return messages.generic;

  switch (value.code) {
    case "RATE_LIMITED":
      return messages.rateLimited;
    case "REFRESH_STALE":
      return messages.refreshStale;
    case "FORBIDDEN":
      return messages.forbidden;
    case "UNAUTHENTICATED":
      return messages.unauthenticated[context];
    case "CONFLICT":
      return messages.conflict;
    case "INVALID_INPUT":
    case "INVALID_REQUEST":
      return context === "login" ? messages.invalidLogin : messages.generic;
    default:
      return messages.generic;
  }
}
