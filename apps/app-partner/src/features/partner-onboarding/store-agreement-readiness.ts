import type { StoreCommercialAgreement } from "./store-commercial-agreement-client";

export type StoreAgreementReadiness = "ACTIVE" | "AWAITING_FINANCE" | "AWAITING_PARTNER" | "NOT_ACTIVE";
export type StoreAgreementReadback = StoreAgreementReadiness | "UNAVAILABLE" | null;

/** Presentational readback only; WLT remains the authority for agreement activation. */
export function storeAgreementReadiness(
  agreements: ReadonlyArray<Pick<StoreCommercialAgreement, "status">>,
): StoreAgreementReadiness {
  if (agreements.some(item => item.status === "ACTIVE")) return "ACTIVE";
  if (agreements.some(item => item.status === "PARTNER_ACCEPTED")) return "AWAITING_FINANCE";
  if (agreements.some(item => item.status === "PROPOSED")) return "AWAITING_PARTNER";
  return "NOT_ACTIVE";
}

/** Reject out-of-scope agreement data even if a backend or proxy returned it. */
export function ownStoreAgreementReadiness(
  agreements: ReadonlyArray<Pick<StoreCommercialAgreement, "status" | "storeId" | "partnerActorId">>,
  storeId: string,
  ownerActorId: string,
): StoreAgreementReadiness | "UNAVAILABLE" {
  if (!storeId || !ownerActorId ||
    agreements.some(item => item.storeId !== storeId || item.partnerActorId !== ownerActorId)) return "UNAVAILABLE";
  return storeAgreementReadiness(agreements);
}

export function agreementReadinessMessage(status: StoreAgreementReadback): string {
  switch (status) {
    case "ACTIVE": return "الاتفاقية سارية";
    case "AWAITING_FINANCE": return "قُبلت الاتفاقية وبانتظار اعتماد المالية";
    case "AWAITING_PARTNER": return "اتفاقية بانتظار قبول مالك المتجر";
    case "NOT_ACTIVE": return "لا توجد اتفاقية سارية للمتجر";
    case "UNAVAILABLE": return "تعذر التحقق من الاتفاقية. راجع تفاصيلها وحاول مجددًا";
    default: return "جارٍ التحقق من الاتفاقية";
  }
}
