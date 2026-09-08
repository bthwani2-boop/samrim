import type { IdentityErrorMessages } from "@bthwani/identity";

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

export const identityCopy: IdentityCopy = {
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
};

export const identityPresentation = {
  direction: "rtl" as const,
  copy: identityCopy,
};
