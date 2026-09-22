import type {
  DeliveryFeePolicy,
  FieldCommissionPolicy,
  JoiningCaseView,
  OfficialWalletDestination,
  PartnerFinancialSummary,
  PayoutRequest,
  ReviewJoiningCaseRequest,
} from "../generated/dsh-types";

type SettlementPeriod = NonNullable<ReviewJoiningCaseRequest["settlementPeriod"]>;

const settlementPeriodLabels: Record<SettlementPeriod, string> = {
  DAILY: "يومية",
  WEEKLY: "أسبوعية",
  MONTHLY: "شهرية",
};

const financialProfileStateLabels: Record<JoiningCaseView["financialProfileState"], string> = {
  REQUIRED: "مطلوب قبل اكتمال الجاهزية المالية",
  PENDING_BINDING: "قيد تثبيت الملف المالي",
  ACTIVE: "نشط",
  FAILED: "يحتاج معالجة مالية",
};

const financialPolicyStateLabels: Record<DeliveryFeePolicy["state"] | FieldCommissionPolicy["state"], string> = {
  ACTIVE: "نشطة",
  RETIRED: "منتهية",
};

const fieldCommissionScopeLabels: Record<FieldCommissionPolicy["scopeType"], string> = {
  DEFAULT: "افتراضي",
  VERTICAL: "مجال تجاري",
  STORE: "متجر",
};

const officialWalletVerificationLabels: Record<OfficialWalletDestination["verificationStatus"], string> = {
  PENDING_VERIFICATION: "بانتظار التحقق",
  VERIFIED: "تم التحقق",
  REJECTED: "مرفوضة",
};

const officialWalletDestinationLabels: Record<OfficialWalletDestination["status"], string> = {
  CANDIDATE: "مرشحة",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  ACTIVE_FOR_PAYOUT: "معتمدة للصرف",
  SUSPENDED: "موقوفة",
  RETIRED: "منتهية الاستخدام",
};

const payoutStatusLabels: Record<PayoutRequest["status"], string> = {
  HELD: "المبلغ محجوز للمراجعة",
  CANCELLED: "ملغى",
  PREPARED: "مهيأ للاعتماد",
  APPROVED: "معتمد",
  FROZEN: "مجمد للتنفيذ",
  EXECUTED: "تم تسجيل التنفيذ",
  COMPLETED: "مكتمل ومطابق",
  EXCEPTION: "يحتاج معالجة",
};

export function settlementPeriodLabel(period: SettlementPeriod): string {
  return settlementPeriodLabels[period];
}

export function financialProfileStateLabel(
  state: JoiningCaseView["financialProfileState"] | PartnerFinancialSummary["profileState"],
): string {
  return financialProfileStateLabels[state];
}

export function financialPolicyStateLabel(
  state: DeliveryFeePolicy["state"] | FieldCommissionPolicy["state"],
): string {
  return financialPolicyStateLabels[state];
}

export function fieldCommissionScopeLabel(scope: FieldCommissionPolicy["scopeType"]): string {
  return fieldCommissionScopeLabels[scope];
}

export function officialWalletVerificationStatusLabel(
  status: OfficialWalletDestination["verificationStatus"],
): string {
  return officialWalletVerificationLabels[status];
}

export function officialWalletDestinationStatusLabel(
  status: OfficialWalletDestination["status"],
): string {
  return officialWalletDestinationLabels[status];
}

export function payoutStatusLabel(status: PayoutRequest["status"]): string {
  return payoutStatusLabels[status];
}
