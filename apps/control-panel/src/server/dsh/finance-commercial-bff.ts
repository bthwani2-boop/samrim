import { type CreateDeliveryFeePolicyRequest, type CreatePartnerFinancialTermsPolicyRequest, type DeliveryFeePolicyResponse, type StoreTypeCommissionDefaultsResponse as DshStoreTypeCommissionDefaultsResponse, dshOperationPaths, type FinanceStoreCommercialAgreementQueueResponse, type PartnerFinancialTermsPolicyResponse, type StoreCommercialAgreementListResponse, type StoreCommercialAgreementMutationResponse, type StoreTypeCommissionDefaultUpdateResponse, type UpdateStoreTypeCommissionDefaultRequest } from "@bthwani/dsh";
import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, validateAttributedMutationContext } from "./dsh-transport";


export async function readOperatorDeliveryFeePolicy(serviceCityId: string, context: DshOperatorReadContext): Promise<DeliveryFeePolicyResponse> {
  if (!context.operatorActorId.trim() || serviceCityId.trim().length > 128) throw new Error("DSH_DELIVERY_FEE_POLICY_READ_INPUT_INVALID");
  const query = serviceCityId.trim() ? `?serviceCityId=${encodeURIComponent(serviceCityId.trim())}` : "";
  const path = `${dshOperationPaths.readOperatorDeliveryFeePolicy.path}${query}`;
  return (await requestDshJson<DeliveryFeePolicyResponse>(dshOperationPaths.readOperatorDeliveryFeePolicy.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorDeliveryFeePolicy(input: CreateDeliveryFeePolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: DeliveryFeePolicyResponse }>> {
  if (!Number.isInteger(input.baseFeeMinor) || input.baseFeeMinor < 0 || !Number.isInteger(input.distanceUnitMeters) || input.distanceUnitMeters < 1 || !Number.isInteger(input.distanceRateMinor) || input.distanceRateMinor < 0 || !Number.isInteger(input.orderSizeUnitBaseUnits) || input.orderSizeUnitBaseUnits < 1 || !Number.isInteger(input.orderSizeRateMinor) || input.orderSizeRateMinor < 0 || !Number.isInteger(input.zoneSurchargeMinor) || input.zoneSurchargeMinor < 0 || input.roundingUnitMinor !== 50 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500 || (input.serviceCityId ?? "").trim().length > 128) throw new Error("DSH_DELIVERY_FEE_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_DELIVERY_FEE_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<DeliveryFeePolicyResponse>(dshOperationPaths.createOperatorDeliveryFeePolicy.method, dshOperationPaths.createOperatorDeliveryFeePolicy.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readOperatorPartnerFinancialTermsPolicy(context: DshOperatorReadContext): Promise<PartnerFinancialTermsPolicyResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_READ_INPUT_INVALID");
  return (await requestDshJson<PartnerFinancialTermsPolicyResponse>(dshOperationPaths.readOperatorPartnerFinancialTermsPolicy.method, dshOperationPaths.readOperatorPartnerFinancialTermsPolicy.path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorPartnerFinancialTermsPolicy(input: CreatePartnerFinancialTermsPolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerFinancialTermsPolicyResponse }>> {
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(input.settlementPeriod) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_IDEMPOTENCY_INVALID");
  return requestDshJson<PartnerFinancialTermsPolicyResponse>(dshOperationPaths.createOperatorPartnerFinancialTermsPolicy.method, dshOperationPaths.createOperatorPartnerFinancialTermsPolicy.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readPartnersStoreCommercialAgreements(storeId: string, context: DshOperatorReadContext): Promise<StoreCommercialAgreementListResponse> {
  const id = storeId.trim();
  if (!id || id.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNERS_STORE_AGREEMENT_READ_INPUT_INVALID");
  const operation = dshOperationPaths.readPartnersStoreCommercialAgreements;
  return (await requestDshJson<StoreCommercialAgreementListResponse>(operation.method, operation.path.replace("{storeId}", encodeURIComponent(id)), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function proposePartnersStoreCommercialAgreement(storeId: string, rates: ReadonlyArray<Readonly<{ fulfillmentMode: "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP"; commissionRateBps: number }>>, expectedCurrentVersion: number, reason: string, context: JoiningCaseMutationContext, terms: Readonly<{ commercialModel?: "COMMISSION" | "SUBSCRIPTION"; recurringAmountMinor?: number; billingPeriod?: "MONTHLY" | "ANNUAL"; billingTimeZone?: "Asia/Aden"; invoiceDueDays?: number; graceDays?: number; renewalPolicy?: "MANUAL" | "AUTOMATIC"; terminationTerms?: string; adjustmentTerms?: string }> = {}): Promise<Readonly<{status:number;payload:StoreCommercialAgreementMutationResponse}>> {
  const id = storeId.trim();
  if (!id || id.length > 128 || !Number.isInteger(expectedCurrentVersion) || expectedCurrentVersion < 0 || !rates.length || rates.length > 3 || new Set(rates.map(rate => rate.fulfillmentMode)).size !== rates.length || rates.some(rate => !["BTHWANI_CAPTAIN","PARTNER_CAPTAIN","CUSTOMER_PICKUP"].includes(rate.fulfillmentMode) || !Number.isInteger(rate.commissionRateBps) || rate.commissionRateBps < 0 || rate.commissionRateBps > 10000) || Array.from(reason.trim()).length < 8 || Array.from(reason.trim()).length > 500) throw new Error("DSH_PARTNERS_STORE_AGREEMENT_PROPOSAL_INVALID");
  validateAttributedMutationContext(context);
  const operation = dshOperationPaths.proposePartnersStoreCommercialAgreement;
  return requestDshJson<StoreCommercialAgreementMutationResponse>(operation.method, operation.path.replace("{storeId}", encodeURIComponent(id)), { rates, expectedCurrentVersion, reason: reason.trim(), ...terms }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}
export async function readOperatorStoreCommercialAgreementQueue(limit: number, cursor: string, context: DshOperatorReadContext): Promise<FinanceStoreCommercialAgreementQueueResponse> {
  const normalizedCursor = cursor.trim();
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50 || normalizedCursor.length > 2048) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_QUEUE_INPUT_INVALID");
  const query = new URLSearchParams({ status: "PARTNER_ACCEPTED", limit: String(limit) });
  if (normalizedCursor) query.set("cursor", normalizedCursor);
  const operation = dshOperationPaths.listFinanceStoreCommercialAgreements;
  return (await requestDshJson<FinanceStoreCommercialAgreementQueueResponse>(operation.method, `${operation.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStoreCommercialAgreementsForFinance(storeId: string, context: DshOperatorReadContext): Promise<StoreCommercialAgreementListResponse> {
  const normalizedStoreId = storeId.trim();
  if (!context.operatorActorId.trim() || !normalizedStoreId || normalizedStoreId.length > 128) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_READ_INPUT_INVALID");
  const operation = dshOperationPaths.readFinanceStoreCommercialAgreements;
  const path = operation.path.replace("{storeId}", encodeURIComponent(normalizedStoreId));
  return (await requestDshJson<StoreCommercialAgreementListResponse>(operation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStoreTypeCommissionDefaults(commercialStoreTypeId: string, context: DshOperatorReadContext): Promise<DshStoreTypeCommissionDefaultsResponse> {
  const normalizedTypeId = commercialStoreTypeId.trim();
  if (!context.operatorActorId.trim() || !normalizedTypeId || normalizedTypeId.length > 128) throw new Error("DSH_STORE_TYPE_COMMISSION_DEFAULTS_INPUT_INVALID");
  const operation = dshOperationPaths.readFinanceStoreTypeCommissionDefaults;
  const path = operation.path.replace("{commercialStoreTypeId}", encodeURIComponent(normalizedTypeId));
  return (await requestDshJson<DshStoreTypeCommissionDefaultsResponse>(operation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function updateOperatorStoreTypeCommissionDefault(commercialStoreTypeId: string, input: UpdateStoreTypeCommissionDefaultRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: StoreTypeCommissionDefaultUpdateResponse }>> {
  const normalizedTypeId = commercialStoreTypeId.trim();
  const validMode = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"].includes(input.fulfillmentMode);
  const reasonLength = Array.from(input.reason.trim()).length;
  if (!normalizedTypeId || normalizedTypeId.length > 128 || !validMode || !Number.isInteger(input.suggestedCommissionRateBps) || input.suggestedCommissionRateBps < 0 || input.suggestedCommissionRateBps > 10000 || !Number.isInteger(input.expectedDefaultVersion) || input.expectedDefaultVersion < 0 || reasonLength < 8 || reasonLength > 500) {
    throw new Error("DSH_STORE_TYPE_COMMISSION_DEFAULT_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_TYPE_COMMISSION_DEFAULT_IDEMPOTENCY_INVALID");
  const operation = dshOperationPaths.updateFinanceStoreTypeCommissionDefault;
  const path = operation.path.replace("{commercialStoreTypeId}", encodeURIComponent(normalizedTypeId));
  return requestDshJson<StoreTypeCommissionDefaultUpdateResponse>(operation.method, path, { ...input, reason: input.reason.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function decideOperatorStoreCommercialAgreement(storeId: string, agreementId: string, decision: "APPROVE" | "REJECT", expectedAgreementVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: StoreCommercialAgreementMutationResponse }>> {
  const normalizedStoreId = storeId.trim();
  const normalizedAgreementId = agreementId.trim();
  const normalizedReason = reason.trim();
  if (!normalizedStoreId || normalizedStoreId.length > 128 || !normalizedAgreementId || normalizedAgreementId.length > 128 || (decision !== "APPROVE" && decision !== "REJECT") || !Number.isInteger(expectedAgreementVersion) || expectedAgreementVersion < 1 || Array.from(normalizedReason).length < 8 || Array.from(normalizedReason).length > 500) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_DECISION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_IDEMPOTENCY_INVALID");
  const operation = dshOperationPaths.decideFinanceStoreCommercialAgreement;
  const path = operation.path.replace("{storeId}", encodeURIComponent(normalizedStoreId)).replace("{agreementId}", encodeURIComponent(normalizedAgreementId));
  return requestDshJson<StoreCommercialAgreementMutationResponse>(operation.method, path, { expectedAgreementVersion, decision, reason: normalizedReason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}
