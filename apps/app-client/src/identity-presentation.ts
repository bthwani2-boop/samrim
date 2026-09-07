import type { IdentityErrorMessages } from "@bthwani/identity";
import { useLocales } from "expo-localization";
import { resolveIdentityDirection, resolveIdentityLocale, type IdentityLocale } from "./identity-locale";

export type { IdentityLocale } from "./identity-locale";

export type IdentityCopy = {
  brand: string;
  restoringSession: string;
  authenticatedStatus: string;
  logout: string;
  busyAction: string;
  serviceUnavailable: string;
  retryVerification: string;
  refreshingSession: string;
  refreshConflict: string;
  syncSession: string;
  syncing: string;
  loginTitle: string;
  registerTitle: string;
  recoverTitle: string;
  phoneLabel: string;
  phonePlaceholder: string;
  passwordLabel: string;
  newPasswordLabel: string;
  passwordConfirmationLabel: string;
  loginPasswordPlaceholder: string;
  newPasswordPlaceholder: string;
  passwordConfirmationPlaceholder: string;
  sendCode: string;
  resendCode: string;
  verificationCodeLabel: string;
  verificationCodePlaceholder: string;
  loginButton: string;
  registerButton: string;
  recoverButton: string;
  proofNotice: string;
  forgotPassword: string;
  signInLink: string;
  newAccountLink: string;
  remoteLogoutFailure: string;
  errors: IdentityErrorMessages;
};

const identityCopy: Record<IdentityLocale, IdentityCopy> = {
  ar: {
    brand: "بثواني",
    restoringSession: "جارٍ التحقق من الجلسة الحية…",
    authenticatedStatus: "تم تسجيل الدخول",
    logout: "تسجيل الخروج",
    busyAction: "جارٍ التنفيذ…",
    serviceUnavailable: "خدمة الهوية غير متاحة",
    retryVerification: "إعادة التحقق",
    refreshingSession: "تحديث جلسة العميل",
    refreshConflict: "تم تجديد بيانات الجلسة من عملية متزامنة. أعد مزامنة الجلسة للمتابعة دون إعادة تسجيل الدخول.",
    syncSession: "مزامنة الجلسة",
    syncing: "جارٍ المزامنة…",
    loginTitle: "تسجيل الدخول",
    registerTitle: "إنشاء حساب",
    recoverTitle: "استعادة كلمة المرور",
    phoneLabel: "رقم الهاتف",
    phonePlaceholder: "+967...",
    passwordLabel: "كلمة المرور",
    newPasswordLabel: "كلمة المرور الجديدة",
    passwordConfirmationLabel: "تأكيد كلمة المرور",
    loginPasswordPlaceholder: "أدخل كلمة المرور",
    newPasswordPlaceholder: "15 حرفًا على الأقل",
    passwordConfirmationPlaceholder: "أعد إدخال كلمة المرور",
    sendCode: "إرسال رمز التحقق",
    resendCode: "إعادة إرسال رمز التحقق",
    verificationCodeLabel: "رمز التحقق",
    verificationCodePlaceholder: "أدخل الرمز المكوّن من 6 أرقام",
    loginButton: "تسجيل الدخول",
    registerButton: "إنشاء الحساب",
    recoverButton: "تعيين كلمة المرور",
    proofNotice: "إذا كانت البيانات صالحة، سيصلك رمز التحقق عبر القناة المهيأة.",
    forgotPassword: "نسيت كلمة المرور؟",
    signInLink: "دخول",
    newAccountLink: "حساب جديد",
    remoteLogoutFailure: "تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم.",
    errors: {
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
    },
  },
  en: {
    brand: "بثواني",
    restoringSession: "Checking your live session…",
    authenticatedStatus: "Signed in",
    logout: "Sign out",
    busyAction: "Working…",
    serviceUnavailable: "Identity service unavailable",
    retryVerification: "Retry verification",
    refreshingSession: "Refreshing client session",
    refreshConflict: "Session data was refreshed by another operation. Sync the session to continue without signing in again.",
    syncSession: "Sync session",
    syncing: "Syncing…",
    loginTitle: "Sign in",
    registerTitle: "Create account",
    recoverTitle: "Recover password",
    phoneLabel: "Phone number",
    phonePlaceholder: "+967...",
    passwordLabel: "Password",
    newPasswordLabel: "New password",
    passwordConfirmationLabel: "Confirm password",
    loginPasswordPlaceholder: "Enter your password",
    newPasswordPlaceholder: "At least 15 characters",
    passwordConfirmationPlaceholder: "Re-enter your password",
    sendCode: "Send verification code",
    resendCode: "Resend verification code",
    verificationCodeLabel: "Verification code",
    verificationCodePlaceholder: "Enter the 6-digit code",
    loginButton: "Sign in",
    registerButton: "Create account",
    recoverButton: "Set password",
    proofNotice: "If the details are valid, you'll receive a verification code through the configured channel.",
    forgotPassword: "Forgot your password?",
    signInLink: "Sign in",
    newAccountLink: "New account",
    remoteLogoutFailure: "Signed out on this device, but the server session revocation could not be confirmed.",
    errors: {
      generic: "We couldn't complete the operation. Check your details and try again.",
      network: "Couldn't connect to the identity service. Check your connection and try again.",
      rateLimited: "Too many attempts. Wait a moment and try again.",
      refreshStale: "The current session has expired. Sign in again.",
      forbidden: "This account or action is not currently allowed.",
      unauthenticated: {
        general: "We couldn't verify the identity details.",
        login: "The phone number or password is incorrect.",
        recovery: "The verification code or new details are incorrect.",
      },
      conflict: "The account state changed. Refresh the data and try again.",
      invalidLogin: "Check the phone number and password.",
    },
  },
};

export function useIdentityPresentation(): {
  locale: IdentityLocale;
  direction: "rtl" | "ltr";
  copy: IdentityCopy;
} {
  const locales = useLocales();
  const locale = resolveIdentityLocale(locales[0]?.languageCode);

  return {
    locale,
    direction: resolveIdentityDirection(locale),
    copy: identityCopy[locale],
  };
}
