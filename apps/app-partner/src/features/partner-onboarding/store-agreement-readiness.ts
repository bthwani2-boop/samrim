import type { StoreCommercialAgreement } from "./store-commercial-agreement-client";

export type StoreAgreementReadiness =
  | "ACTIVE" | "AWAITING_FINANCE" | "AWAITING_PARTNER"
  | "SUBSCRIPTION_PENDING_BILLING" | "RETIRED_MODEL" | "NOT_ACTIVE";
export type StoreAgreementReadback = StoreAgreementReadiness | "UNAVAILABLE" | null;

type AgreementStatusFact = Pick<StoreCommercialAgreement, "status"> &
  Partial<Pick<StoreCommercialAgreement, "commercialModel">>;

/** Presentation-only state. WLT is the sole activation authority, and recurring billing is not active. */
export function storeAgreementReadiness(
  agreements: ReadonlyArray<AgreementStatusFact>,
): StoreAgreementReadiness {
  if (agreements.some(item => item.status === "ACTIVE")) return "ACTIVE";
  if (agreements.some(item => item.status === "PARTNER_ACCEPTED" &&
    item.commercialModel === "COMMISSION")) return "AWAITING_FINANCE";
  if (agreements.some(item => item.status === "PARTNER_ACCEPTED" && item.commercialModel === "SUBSCRIPTION")) return "SUBSCRIPTION_PENDING_BILLING";
  if (agreements.some(item => item.status === "PROPOSED" &&
    (item.commercialModel === "COMMISSION" || item.commercialModel === "SUBSCRIPTION"))) return "AWAITING_PARTNER";
  if (agreements.some(item => (item.status === "PROPOSED" || item.status === "PARTNER_ACCEPTED") &&
    item.commercialModel === "HYBRID")) return "RETIRED_MODEL";
  return "NOT_ACTIVE";
}

/** Reject out-of-scope agreement data even if a backend or proxy returned it. */
export function ownStoreAgreementReadiness(
  agreements: ReadonlyArray<AgreementStatusFact & Pick<StoreCommercialAgreement, "storeId" | "partnerActorId">>,
  storeId: string,
  ownerActorId: string,
): StoreAgreementReadiness | "UNAVAILABLE" {
  if (!storeId || !ownerActorId ||
    agreements.some(item => item.storeId !== storeId || item.partnerActorId !== ownerActorId)) return "UNAVAILABLE";
  return storeAgreementReadiness(agreements);
}

/** Explain one persisted agreement without implying that an accepted subscription can be activated. */
export function agreementStatusLabel(agreement: Pick<StoreCommercialAgreement, "status" | "commercialModel">): string {
  if (agreement.commercialModel === "SUBSCRIPTION" && agreement.status === "PARTNER_ACCEPTED")
    return "قُبل الاشتراك · التفعيل والتحصيل متوقفان حتى اكتمال الفوترة";
  if (agreement.commercialModel === "HYBRID" &&
    (agreement.status === "PROPOSED" || agreement.status === "PARTNER_ACCEPTED"))
    return "اتفاقية مختلطة قديمة · لا يمكن قبولها أو تفعيلها";
  switch (agreement.status) {
    case "PROPOSED": return "بانتظار قبول مالك المتجر";
    case "PARTNER_ACCEPTED": return "قُبلت من المالك · بانتظار اعتماد المالية";
    case "ACTIVE": return "سارية";
    case "FINANCE_REJECTED":
    case "REJECTED": return "مرفوضة";
    case "SUPERSEDED": return "استُبدلت باتفاق أحدث";
    default: return `الحالة: ${agreement.status}`;
  }
}

/** User-safe recovery for typed DSH failures; never expose tokens, URLs or server payloads. */
export function agreementReadbackErrorMessage(cause: unknown): string {
  if (cause && typeof cause === "object") {
    const value = cause as { status?: unknown; code?: unknown; message?: unknown };
    if (value.status === 401) return "انتهت صلاحية جلسة الحساب؛ أعد التحقق من تسجيل الدخول.";
    if (value.status === 403) return "لا يملك الحساب الحالي صلاحية قراءة اتفاقيات هذا المتجر.";
    if (value.status === 404) return "تعذر العثور على المتجر ضمن سجل الاتفاقيات؛ أعد اختيار المتجر.";
    if (value.code === "INVALID_RESPONSE") return "بيانات الاتفاقية الواردة من الخدمة غير مكتملة؛ يرجى إبلاغ الدعم الفني.";
    if (value.code === "STORE_SCOPE_MISMATCH" || value.message === "AGREEMENT_ACTOR_SCOPE_MISMATCH")
      return "تعارض في نطاق المتجر أو مالك الاتفاقية؛ أعد التحقق من حسابك.";
    if (typeof value.status === "number" && value.status >= 500) return "خدمة الاتفاقيات غير متاحة حاليًا؛ أعد القراءة أو أبلغ الدعم الفني.";
    if (value.message === "DSH_BASE_URL_REQUIRED") return "تعذر الاتصال بخدمة الاتفاقيات.";
  }
  return "تعذر التحقق من الاتفاقية؛ أعد قراءة الحالة أو أبلغ الدعم الفني.";
}

export function agreementReadinessMessage(status: StoreAgreementReadback): string {
  switch (status) {
    case "ACTIVE": return "الاتفاقية سارية";
    case "AWAITING_FINANCE": return "قُبلت اتفاقية العمولة وبانتظار اعتماد المالية";
    case "SUBSCRIPTION_PENDING_BILLING": return "قُبل مقترح الاشتراك، لكن التفعيل والتحصيل متوقفان حتى اكتمال الفوترة والمراجعة المالية";
    case "RETIRED_MODEL": return "الاتفاقية المختلطة القديمة غير قابلة للقبول أو التفعيل؛ تواصل مع قسم الشركاء";
    case "AWAITING_PARTNER": return "اتفاقية بانتظار قبول مالك المتجر";
    case "NOT_ACTIVE": return "لا توجد اتفاقية سارية للمتجر";
    case "UNAVAILABLE": return "تعذر التحقق من الاتفاقية. راجع تفاصيلها وحاول مجددًا";
    default: return "جارٍ التحقق من الاتفاقية";
  }
}
