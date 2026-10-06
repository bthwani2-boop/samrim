export const storeCommercialAgreementModes = [
  { key: "BTHWANI_CAPTAIN", label: "توصيل بثواني" },
  { key: "PARTNER_CAPTAIN", label: "توصيل المتجر" },
  { key: "CUSTOMER_PICKUP", label: "استلام من المتجر" },
] as const;

type StoreCommercialAgreementMode = (typeof storeCommercialAgreementModes)[number]["key"];

type StoreCommercialAgreementRate = Readonly<{
  fulfillmentMode: StoreCommercialAgreementMode;
  commissionRateBps: number;
}>;

export type StoreCommercialAgreementRecord = Readonly<{
  agreementId: string;
  storeId: string;
  partnerActorId: string;
  agreementVersion: number;
  status: "PROPOSED" | "PARTNER_ACCEPTED" | "ACTIVE" | "FINANCE_REJECTED" | "SUPERSEDED";
  rates: readonly StoreCommercialAgreementRate[];
  proposedByActorId: string;
  proposedAt: string;
  partnerAcceptedByActorId: string | null;
  partnerAcceptedAt: string | null;
  financeApprovedByActorId: string | null;
  financeApprovedAt: string | null;
  financeDecisionByActorId: string | null;
  financeDecisionAt: string | null;
  financeDecisionReason: string | null;
  effectiveAt: string | null;
  supersededAt: string | null;
  reason: string;
}>;

export type FinanceStoreCommercialAgreement = StoreCommercialAgreementRecord & Readonly<{
  storeName: string;
  currentStoreOwnerActorId: string;
  commercialStoreTypeId: string;
  commercialStoreTypeNameAr: string;
  fulfillmentModes: readonly StoreCommercialAgreementMode[];
  matchesCurrentFulfillmentModes: boolean;
}>;

export type StoreCommercialAgreementQueueResponse = Readonly<{
  agreements: readonly FinanceStoreCommercialAgreement[];
  nextCursor?: string;
}>;

export type StoreCommercialAgreementDecision = "APPROVE" | "REJECT";

export type StoreCommercialAgreementDecisionResponse = Readonly<{
  agreement: StoreCommercialAgreementRecord;
  idempotentReplay: boolean;
}>;

type StoreTypeCommissionDefault = Readonly<{
  commercialStoreTypeId: string;
  fulfillmentMode: StoreCommercialAgreementMode;
  suggestedCommissionRateBps: number;
  defaultVersion: number;
  changedByActorId?: string;
  changeReason?: string;
}>;

export type StoreTypeCommissionDefaultsResponse = Readonly<{
  commercialStoreTypeId: string;
  defaults: readonly StoreTypeCommissionDefault[];
}>;
