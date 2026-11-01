import { type StoreTypeCommissionDefaultsResponse as DshStoreTypeCommissionDefaultsResponse, type FinanceStoreCommercialAgreementQueueResponse, type StoreCommercialAgreementListResponse, type StoreCommercialAgreementMutationResponse, type StorePayoutRecipientListResponse, type ActorLegalName, type BeneficiaryPayoutState, type BeneficiaryPayoutStateResponse, type CashCustodyRegistryResponse, type CreateCustomerWithdrawalIntakeRequest, type CreateDeliveryFeePolicyRequest, type CreatePartnerFinancialTermsPolicyRequest, type CustomerWithdrawalDecisionRequest, type CustomerWithdrawalIntakeListResponse, type CustomerWithdrawalIntakeResponse, type DeliveryFeePolicyResponse, dshOperationPaths, type FinanceEvidenceDocument, type OfficialWalletDestination, type PartnerCommissionReceivableRegistryResponse, type PartnerCommissionRemittanceRequest, type PartnerCommissionRemittanceResponse, type PartnerFinancialSummaryResponse, type PartnerFinancialTermsPolicyResponse, type PayoutRequest, type SettlementBatch, type SettlementBatchExport, type StoreTypeCommissionDefaultUpdateResponse, type SubmitActorLegalNameRequest, type UpdateStoreTypeCommissionDefaultRequest, type VerifyActorLegalNameRequest } from "@bthwani/dsh";
import { requestDshJson, requestDshMultipart, requestDshFile, validateAttributedMutationContext, type DshOperatorReadContext, type JoiningCaseMutationContext } from "./dsh-transport";

export async function listOperatorCashCustody(search: string, sort: "collected_asc" | "collected_desc", cursor: string, limit: number, context: DshOperatorReadContext): Promise<CashCustodyRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_CASH_CUSTODY_INPUT_INVALID");
  if (search.trim().length > 128 || cursor.length > 1024 || !["collected_asc", "collected_desc"].includes(sort) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_CASH_CUSTODY_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ search: search.trim(), sort, limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  const path = `${dshOperationPaths.listOperatorCashCustody.path}?${query.toString()}`;
  return (await requestDshJson<CashCustodyRegistryResponse>(dshOperationPaths.listOperatorCashCustody.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function reconcileOperatorCashRemittance(remittanceId: string, evidenceDocumentId: string, context: JoiningCaseMutationContext): Promise<import("@bthwani/dsh").CaptainCashRemittanceResponse> {
  if (!remittanceId.trim() || remittanceId.trim().length > 128 || !evidenceDocumentId.trim() || evidenceDocumentId.trim().length > 128) throw new Error("DSH_CASH_REMITTANCE_RECONCILIATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.reconcileOperatorCashRemittance.path.replace("{remittanceId}", encodeURIComponent(remittanceId.trim()));
  return (await requestDshJson<import("@bthwani/dsh").CaptainCashRemittanceResponse>(dshOperationPaths.reconcileOperatorCashRemittance.method, path, { evidenceDocumentId: evidenceDocumentId.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function readOperatorPartnerFinancialActivity(
  partnerActorId: string,
  filters: Readonly<Record<string, string>>,
  context: DshOperatorReadContext,
): Promise<import("@bthwani/dsh").PartnerFinancialActivityPage> {
  if (!partnerActorId.trim() || partnerActorId.length > 128 || !context.operatorActorId.trim()) throw new Error("INVALID_PARTNER_ACTIVITY_SCOPE");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const path = "/dsh/operator/partners/" + encodeURIComponent(partnerActorId.trim()) + "/financial-activity?" + query;
  return (await requestDshJson<import("@bthwani/dsh").PartnerFinancialActivityPage>("GET", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPartnerFinancialSummary(partnerActorId: string, context: DshOperatorReadContext): Promise<PartnerFinancialSummaryResponse> {
  if (!partnerActorId.trim() || partnerActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_FINANCIAL_SUMMARY_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPartnerFinancialSummary.path.replace("{partnerActorId}", encodeURIComponent(partnerActorId.trim()));
  return (await requestDshJson<PartnerFinancialSummaryResponse>(dshOperationPaths.readOperatorPartnerFinancialSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPartnerStorePayoutRecipients(partnerActorId: string, context: DshOperatorReadContext): Promise<StorePayoutRecipientListResponse> {
  if (!partnerActorId.trim() || partnerActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_PAYOUT_RECIPIENTS_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPartnerStorePayoutRecipients.path.replace("{partnerActorId}", encodeURIComponent(partnerActorId.trim()));
  return (await requestDshJson<StorePayoutRecipientListResponse>(dshOperationPaths.readOperatorPartnerStorePayoutRecipients.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorPartnerCommissionReceivables(search: string, sort: "actor_asc" | "actor_desc", cursor: string, limit: number, context: DshOperatorReadContext): Promise<PartnerCommissionReceivableRegistryResponse> {
  if (!context.operatorActorId.trim() || search.trim().length > 128 || cursor.length > 1024 || !["actor_asc", "actor_desc"].includes(sort) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("DSH_PARTNER_COMMISSION_REGISTRY_INPUT_INVALID");
  }
  const query = new URLSearchParams({ sort, limit: String(limit) });
  if (search.trim()) query.set("search", search.trim());
  if (cursor.trim()) query.set("cursor", cursor.trim());
  const path = `${dshOperationPaths.listOperatorPartnerCommissionReceivables.path}?${query.toString()}`;
  return (await requestDshJson<PartnerCommissionReceivableRegistryResponse>(dshOperationPaths.listOperatorPartnerCommissionReceivables.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function recordOperatorPartnerCommissionRemittance(partnerActorId: string, input: PartnerCommissionRemittanceRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerCommissionRemittanceResponse }>> {
  const normalizedPartnerActorID = partnerActorId.trim();
  if (!normalizedPartnerActorID || normalizedPartnerActorID.length > 128 || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || input.remittanceReference.trim().length < 1 || input.remittanceReference.trim().length > 128 || input.evidenceDocumentId.trim().length < 1 || input.evidenceDocumentId.trim().length > 128) {
    throw new Error("DSH_PARTNER_COMMISSION_REMITTANCE_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (context.idempotencyKey.trim().length < 8 || context.idempotencyKey.trim().length > 128) throw new Error("DSH_PARTNER_COMMISSION_REMITTANCE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.recordPartnerCommissionRemittance.path.replace("{partnerActorId}", encodeURIComponent(normalizedPartnerActorID));
  return requestDshJson<PartnerCommissionRemittanceResponse>(dshOperationPaths.recordPartnerCommissionRemittance.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

type BeneficiaryActorType = "customer" | "partner" | "captain" | "field";
type OperatorDestinationResponse = Readonly<{ destination: OfficialWalletDestination; idempotentReplay?: boolean }>;
type OperatorWalletProviderIntentResponse = Readonly<{ intent: Readonly<{ actorType: "partner" | "captain"; actorId: string; providerKey: string; sourceId: string }> }>;
export async function readOperatorPayoutState(actorType: BeneficiaryActorType, actorId: string, context: DshOperatorReadContext): Promise<BeneficiaryPayoutStateResponse> {
  if (!("customer" === actorType || "partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_PAYOUT_STATE_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPayoutState.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<BeneficiaryPayoutStateResponse>(dshOperationPaths.readOperatorPayoutState.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorBeneficiaryRegistryResponse = Readonly<{ beneficiaries: ReadonlyArray<BeneficiaryPayoutState>; nextCursor?: string; limit: number }>;
type BeneficiaryRegistryActorType = "partner" | "captain" | "field";
export type BeneficiaryRegistrySort = "actor_asc" | "actor_desc" | "available_asc" | "available_desc" | "held_asc" | "held_desc" | "payout_amount_asc" | "payout_amount_desc";
export async function listOperatorBeneficiaryPayoutStates(actorType: BeneficiaryRegistryActorType | "", search: string, status: string, sort: BeneficiaryRegistrySort, cursor: string, limit: number, context: DshOperatorReadContext): Promise<OperatorBeneficiaryRegistryResponse> {
  if (!context.operatorActorId.trim() || (actorType && !(actorType === "partner" || actorType === "captain" || actorType === "field")) || search.trim().length > 128 || cursor.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 100 || status.length > 32 || !["actor_asc", "actor_desc", "available_asc", "available_desc", "held_asc", "held_desc", "payout_amount_asc", "payout_amount_desc"].includes(sort)) throw new Error("DSH_BENEFICIARY_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (actorType) query.set("actorType", actorType);
  if (search.trim()) query.set("search", search.trim());
  if (status.trim()) query.set("status", status.trim());
  query.set("sort", sort);
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorBeneficiaryRegistryResponse>(dshOperationPaths.listOperatorBeneficiaryPayoutStates.method, `${dshOperationPaths.listOperatorBeneficiaryPayoutStates.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorDestination(actorType: BeneficiaryActorType, actorId: string, context: DshOperatorReadContext): Promise<OperatorDestinationResponse> {
	if (!("customer" === actorType || "partner" === actorType || "captain" === actorType) || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.readOperatorOfficialWalletDestination.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorWalletProviderIntent(actorType: "partner" | "captain", actorId: string, context: DshOperatorReadContext): Promise<OperatorWalletProviderIntentResponse> {
  if (!(actorType === "partner" || actorType === "captain") || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_WALLET_PROVIDER_INTENT_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorWalletProviderIntent.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<OperatorWalletProviderIntentResponse>(dshOperationPaths.readOperatorWalletProviderIntent.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPendingActorLegalName(actorId: string, context: DshOperatorReadContext): Promise<Readonly<{ legalName: ActorLegalName }>> {
  if (!actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_LEGAL_NAME_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPendingActorLegalName.path.replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<Readonly<{ legalName: ActorLegalName }>>(dshOperationPaths.readOperatorPendingActorLegalName.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function submitOperatorActorLegalName(actorId: string, input: SubmitActorLegalNameRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ legalName: ActorLegalName }>> {
  if (!actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_LEGAL_NAME_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.submitOperatorActorLegalName.path.replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<Readonly<{ legalName: ActorLegalName }>>(dshOperationPaths.submitOperatorActorLegalName.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function verifyOperatorActorLegalName(actorId: string, version: number, input: VerifyActorLegalNameRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ legalName: ActorLegalName }>> {
  if (!actorId.trim() || !Number.isInteger(version) || version < 1 || !context.operatorActorId.trim()) throw new Error("DSH_LEGAL_NAME_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.verifyOperatorActorLegalName.path.replace("{actorId}", encodeURIComponent(actorId.trim())).replace("{version}", String(version));
  return (await requestDshJson<Readonly<{ legalName: ActorLegalName }>>(dshOperationPaths.verifyOperatorActorLegalName.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function createOperatorDestination(actorType: "partner" | "captain", actorId: string, input: Readonly<{ changeReason: string; verificationEvidenceReference: string; changeEvidenceReference: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: OperatorDestinationResponse }>> {
	if (!(actorType === "partner" || actorType === "captain") || !actorId.trim() || !input.changeReason.trim() || !input.verificationEvidenceReference.trim() || !input.changeEvidenceReference.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.createOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return requestDshJson<OperatorDestinationResponse>(dshOperationPaths.createOperatorOfficialWalletDestination.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function verifyOperatorDestination(actorType: BeneficiaryActorType, actorId: string, destinationId: string, evidenceReference: string, context: JoiningCaseMutationContext): Promise<OperatorDestinationResponse> {
  if (!("partner" === actorType || "captain" === actorType) || !actorId.trim() || !destinationId.trim() || !evidenceReference.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.verifyOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim())).replace("{destinationId}", encodeURIComponent(destinationId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.verifyOperatorOfficialWalletDestination.method, path, { evidenceReference }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function activateOperatorDestination(actorType: BeneficiaryActorType, actorId: string, destinationId: string, context: JoiningCaseMutationContext): Promise<OperatorDestinationResponse> {
  if (!("partner" === actorType || "captain" === actorType) || !actorId.trim() || !destinationId.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.activateOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim())).replace("{destinationId}", encodeURIComponent(destinationId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.activateOperatorOfficialWalletDestination.method, path, {}, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

type OperatorPayoutListResponse = Readonly<{ payouts: ReadonlyArray<PayoutRequest> }>;
type OperatorPayoutResponse = Readonly<{ payout: PayoutRequest }>;

export async function listOperatorPayoutRequests(status: string, context: DshOperatorReadContext): Promise<OperatorPayoutListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PAYOUT_QUEUE_INPUT_INVALID");
  const query = status.trim() ? `?status=${encodeURIComponent(status.trim())}` : "";
  return (await requestDshJson<OperatorPayoutListResponse>(dshOperationPaths.listOperatorPayoutRequests.method, `${dshOperationPaths.listOperatorPayoutRequests.path}${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorSettlementIntake = Readonly<{
  id: string; actorType: "partner" | "captain" | "field"; actorId: string; requestedBy: string;
  resolvedAmountMinor: number; currency: "YER"; status: "REQUESTED" | "CONVERTED" | "CANCELLED";
  storeAllocations: readonly Readonly<{ storeId: string; amountMinor: number }>[];
  payoutReference?: string; payoutStatus?: string; payoutUpdatedAt?: string; createdAt: string;
}>;
export async function listOperatorSettlementIntakes(context: DshOperatorReadContext): Promise<Readonly<{ intakes: readonly OperatorSettlementIntake[] }>> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_SETTLEMENT_INTAKE_OPERATOR_REQUIRED");
  return (await requestDshJson<Readonly<{ intakes: readonly OperatorSettlementIntake[] }>>("GET", "/dsh/operator/settlement-intakes", undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function convertOperatorSettlementIntake(intakeId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ intake: OperatorSettlementIntake }>> {
  validateAttributedMutationContext(context);
  if (!intakeId.trim() || intakeId.length > 128) throw new Error("DSH_SETTLEMENT_INTAKE_ID_REQUIRED");
  return (await requestDshJson<Readonly<{ intake: OperatorSettlementIntake }>>("POST", "/dsh/operator/settlement-intakes/" + encodeURIComponent(intakeId.trim()) + "/convert", {}, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(),
  })).payload;
}

export async function cancelOperatorSettlementIntake(intakeId: string, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ intake: OperatorSettlementIntake }>> {
  validateAttributedMutationContext(context);
  if (!intakeId.trim() || intakeId.length > 128 || !reason.trim() || reason.trim().length > 512) throw new Error("DSH_SETTLEMENT_INTAKE_CANCEL_INPUT_INVALID");
  return (await requestDshJson<Readonly<{ intake: OperatorSettlementIntake }>>("POST", "/dsh/operator/settlement-intakes/" + encodeURIComponent(intakeId.trim()) + "/cancel", { reason: reason.trim() }, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(),
  })).payload;
}

export type FinanceEvidencePurpose = "TRANSFER_RECEIPT" | "SETTLEMENT_STATEMENT" | "CUSTOMER_WITHDRAWAL_REQUEST";
export type OperatorFinanceEvidenceResponse = Readonly<{ document: FinanceEvidenceDocument }>;
export type OperatorSettlementStatement = Readonly<{ id: string; batchId?: string | null; providerKey: string; currency: "YER"; periodStart: string; periodEnd: string; evidenceDocumentId: string; filename: string; artifactSHA256: string; uploadedBy: string; createdAt: string }>;
export type OperatorSettlementStatementRow = Readonly<{ id: string; statementId: string; rowSequence: number; externalTransferReference: string; amountMinor: number; currency: "YER"; transactionAt: string; recordedBy: string; matchedTransferId?: string | null }>;

export async function uploadOperatorFinanceEvidence(purpose: FinanceEvidencePurpose, file: File, context: JoiningCaseMutationContext): Promise<OperatorFinanceEvidenceResponse> {
  if (!(purpose === "TRANSFER_RECEIPT" || purpose === "SETTLEMENT_STATEMENT" || purpose === "CUSTOMER_WITHDRAWAL_REQUEST") || !file.size || file.size > 10 * 1024 * 1024 || !file.name.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FINANCE_EVIDENCE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", file, file.name);
  return (await requestDshMultipart<OperatorFinanceEvidenceResponse>(dshOperationPaths.uploadOperatorFinanceEvidence.method, dshOperationPaths.uploadOperatorFinanceEvidence.path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function uploadCustomerWithdrawalRequestEvidence(file: File, context: JoiningCaseMutationContext): Promise<OperatorFinanceEvidenceResponse> {
  if (!file.size || file.size > 10 * 1024 * 1024 || !file.name.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const form = new FormData();
  form.set("file", file, file.name);
  return (await requestDshMultipart<OperatorFinanceEvidenceResponse>(dshOperationPaths.uploadCustomerWithdrawalRequestEvidence.method, dshOperationPaths.uploadCustomerWithdrawalRequestEvidence.path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function listOperatorCustomerWithdrawalIntakes(status: string, search: string, sort: string, cursor: string, limit: number, context: DshOperatorReadContext): Promise<CustomerWithdrawalIntakeListResponse> {
  const normalizedStatus = status.trim();
  const normalizedSearch = search.trim();
  const normalizedSort = sort.trim() || "requested_desc";
  const normalizedCursor = cursor.trim();
  if (!context.operatorActorId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || normalizedStatus.length > 32 || normalizedSearch.length > 128 || normalizedCursor.length > 1024 || (normalizedSort !== "requested_desc" && normalizedSort !== "requested_asc")) throw new Error("DSH_CUSTOMER_WITHDRAWAL_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (normalizedStatus) query.set("status", normalizedStatus);
  if (normalizedSearch) query.set("search", normalizedSearch);
  query.set("sort", normalizedSort);
  if (normalizedCursor) query.set("cursor", normalizedCursor);
  return (await requestDshJson<CustomerWithdrawalIntakeListResponse>(dshOperationPaths.listOperatorCustomerWithdrawalIntakes.method, `${dshOperationPaths.listOperatorCustomerWithdrawalIntakes.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorCustomerWithdrawalIntake(intakeId: string, context: DshOperatorReadContext): Promise<CustomerWithdrawalIntakeResponse> {
  const normalized = intakeId.trim();
  if (!normalized || normalized.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_CUSTOMER_WITHDRAWAL_READ_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorCustomerWithdrawalIntake.path.replace("{intakeId}", encodeURIComponent(normalized));
  return (await requestDshJson<CustomerWithdrawalIntakeResponse>(dshOperationPaths.readOperatorCustomerWithdrawalIntake.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorCustomerWithdrawalIntake(input: CreateCustomerWithdrawalIntakeRequest, context: JoiningCaseMutationContext): Promise<CustomerWithdrawalIntakeResponse> {
	const request: CreateCustomerWithdrawalIntakeRequest = { customerActorId: input.customerActorId.trim(), providerKey: input.providerKey.trim(), requestReason: input.requestReason.trim(), requestEvidenceDocumentId: input.requestEvidenceDocumentId.trim() };
	return (await requestDshJson<CustomerWithdrawalIntakeResponse>(dshOperationPaths.createOperatorCustomerWithdrawalIntake.method, dshOperationPaths.createOperatorCustomerWithdrawalIntake.path, request, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

async function customerWithdrawalDecision(operation: "prepareOperatorCustomerWithdrawalDestination" | "verifyOperatorCustomerWithdrawalDestination" | "activateOperatorCustomerWithdrawalDestination" | "acceptOperatorCustomerWithdrawal" | "rejectOperatorCustomerWithdrawal", intakeId: string, input: Readonly<Record<string, string>>, context: JoiningCaseMutationContext): Promise<Readonly<Record<string, unknown>>> {
  if (!intakeId.trim()) throw new Error("DSH_CUSTOMER_WITHDRAWAL_INPUT_INVALID");
  const path = dshOperationPaths[operation].path.replace("{intakeId}", encodeURIComponent(intakeId.trim()));
  return (await requestDshJson<Readonly<Record<string, unknown>>>(dshOperationPaths[operation].method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export const prepareOperatorCustomerWithdrawalDestination = (intakeId: string, input: CustomerWithdrawalDecisionRequest, context: JoiningCaseMutationContext) => customerWithdrawalDecision("prepareOperatorCustomerWithdrawalDestination", intakeId, input, context);
export const verifyOperatorCustomerWithdrawalDestination = (intakeId: string, evidenceReference: string, context: JoiningCaseMutationContext) => customerWithdrawalDecision("verifyOperatorCustomerWithdrawalDestination", intakeId, { evidenceReference }, context);
export const activateOperatorCustomerWithdrawalDestination = (intakeId: string, context: JoiningCaseMutationContext) => customerWithdrawalDecision("activateOperatorCustomerWithdrawalDestination", intakeId, {}, context);
export const acceptOperatorCustomerWithdrawal = (intakeId: string, input: CustomerWithdrawalDecisionRequest, context: JoiningCaseMutationContext) => customerWithdrawalDecision("acceptOperatorCustomerWithdrawal", intakeId, input, context);
export const rejectOperatorCustomerWithdrawal = (intakeId: string, input: CustomerWithdrawalDecisionRequest, context: JoiningCaseMutationContext) => customerWithdrawalDecision("rejectOperatorCustomerWithdrawal", intakeId, input, context);

export async function readOperatorFinanceEvidence(documentId: string, context: DshOperatorReadContext) {
  if (!documentId.trim() || documentId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorFinanceEvidence.path.replace("{documentId}", encodeURIComponent(documentId.trim()));
  return requestDshFile(path, { "X-Acting-Actor-ID": context.operatorActorId.trim() });
}

export async function registerOperatorSettlementStatement(input: Readonly<{ batchId?: string; providerKey: string; currency: "YER"; periodStart: string; periodEnd: string; evidenceDocumentId: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ statement: OperatorSettlementStatement }>> {
  if (!input.providerKey.trim() || !input.evidenceDocumentId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd) || input.periodEnd < input.periodStart) throw new Error("DSH_SETTLEMENT_STATEMENT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.registerOperatorSettlementStatement.path;
  return (await requestDshJson<Readonly<{ statement: OperatorSettlementStatement }>>(dshOperationPaths.registerOperatorSettlementStatement.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function recordOperatorSettlementStatementRow(statementId: string, input: Readonly<{ rowSequence: number; externalTransferReference: string; walletIdentifier: string; amountMinor: number; currency: "YER"; transactionAt: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ row: OperatorSettlementStatementRow }>> {
  if (!statementId.trim() || !Number.isSafeInteger(input.rowSequence) || input.rowSequence < 1 || !input.externalTransferReference.trim() || !input.walletIdentifier.trim() || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || !Number.isFinite(Date.parse(input.transactionAt))) throw new Error("DSH_SETTLEMENT_STATEMENT_ROW_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.recordOperatorStatementRow.path.replace("{statementId}", encodeURIComponent(statementId.trim()));
  return (await requestDshJson<Readonly<{ row: OperatorSettlementStatementRow }>>(dshOperationPaths.recordOperatorStatementRow.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export type OperatorSettlementBatchExport = SettlementBatchExport;

export async function exportOperatorSettlementBatch(batchId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ export: OperatorSettlementBatchExport }>> {
  if (!batchId.trim()) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.exportOperatorSettlementBatch.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ export: OperatorSettlementBatchExport }>>(dshOperationPaths.exportOperatorSettlementBatch.method, path, {}, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function readOperatorSettlementBatch(batchId: string, context: DshOperatorReadContext): Promise<Readonly<{ batch: SettlementBatch }>> {
  if (!batchId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorSettlementBatch.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ batch: SettlementBatch }>>(dshOperationPaths.readOperatorSettlementBatch.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorFinancialStatement = Readonly<{
  actorType: "customer" | "partner" | "captain" | "field";
  actorId: string;
  currency: "YER";
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  creditsMinor: number;
  debitsMinor: number;
  closingBalanceMinor: number;
  currentBalanceMinor: number;
  nextCursor?: string;
  limit: number;
  entries: ReadonlyArray<Readonly<{
    transactionId: string;
    transactionType: string;
    sourceType: string;
    sourceId: string;
    direction: "CREDIT" | "DEBIT";
    amountMinor: number;
    currency: "YER";
    createdAt: string;
    balanceAfterMinor: number;
    order?: Readonly<{
      orderId: string;
      storeName: string;
      state: string;
      fulfillmentMode: string;
      subtotalAmountMinor: number;
      discountMinor: number;
      totalAmountMinor: number;
      currency: "YER";
      createdAt: string;
      lines: ReadonlyArray<Readonly<{ productName: string; variantTitle: string; quantityBaseUnits: number; unitPriceMinor: number; lineAmountMinor: number; currency: "YER" }>>;
    }>;
  }>>;
}>;

export async function readOperatorBeneficiaryFinancialStatement(actorType: "customer" | "partner" | "captain" | "field", actorId: string, from: string, to: string, cursor: string, context: DshOperatorReadContext): Promise<Readonly<{ statement: OperatorFinancialStatement }>> {
  if (!actorId.trim() || actorId.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || !context.operatorActorId.trim()) throw new Error("DSH_FINANCIAL_STATEMENT_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorBeneficiaryFinancialStatement.path
    .replace("{actorType}", encodeURIComponent(actorType))
    .replace("{actorId}", encodeURIComponent(actorId.trim()));
  const query = new URLSearchParams({ from, to });
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<Readonly<{ statement: OperatorFinancialStatement }>>(dshOperationPaths.readOperatorBeneficiaryFinancialStatement.method, `${path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorFinancialStatementSummaryRegistry = Readonly<{
  actorType: "customer" | "partner" | "captain" | "field";
  periodStart: string;
  periodEnd: string;
  summaries: ReadonlyArray<Readonly<{ actorType: string; actorId: string; displayName?: string; phoneMasked?: string; beneficiaryName?: string; walletIdentifierMasked?: string; currency: "YER"; openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number; currentBalanceMinor: number; heldMinor: number; availableMinor: number }>>;
  nextCursor?: string;
  limit: number;
}>;

export async function listOperatorFinancialStatementSummaries(actorType: OperatorFinancialStatementSummaryRegistry["actorType"], from: string, to: string, cursor: string, context: DshOperatorReadContext): Promise<OperatorFinancialStatementSummaryRegistry> {
  if (!context.operatorActorId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new Error("DSH_FINANCIAL_STATEMENT_INPUT_INVALID");
  const query = new URLSearchParams({ actorType, from, to, limit: "200" });
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorFinancialStatementSummaryRegistry>(dshOperationPaths.listOperatorFinancialStatementSummaries.method, `${dshOperationPaths.listOperatorFinancialStatementSummaries.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorSettlementBatch(payoutIds: readonly string[], context: JoiningCaseMutationContext): Promise<Readonly<{ batch: SettlementBatch }>> {
  if (!payoutIds.length || payoutIds.length > 100 || payoutIds.some((id) => !id.trim())) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  validateAttributedMutationContext(context);
  return (await requestDshJson<Readonly<{ batch: SettlementBatch }>>(dshOperationPaths.createOperatorSettlementBatch.method, dshOperationPaths.createOperatorSettlementBatch.path, { payoutIds }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export type OperatorSettlementBatchRegistryResponse = Readonly<{ batches: ReadonlyArray<SettlementBatch>; nextCursor?: string; limit: number }>;
export async function listOperatorSettlementBatches(status: string, cursor: string, limit: number, context: DshOperatorReadContext): Promise<OperatorSettlementBatchRegistryResponse> {
  if (!context.operatorActorId.trim() || status.length > 32 || cursor.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_SETTLEMENT_BATCH_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (status.trim()) query.set("status", status.trim());
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorSettlementBatchRegistryResponse>(dshOperationPaths.listOperatorSettlementBatches.method, `${dshOperationPaths.listOperatorSettlementBatches.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function transitionOperatorSettlementBatch(batchId: string, action: "approve" | "freeze", reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ batch: SettlementBatch }>> {
  if (!batchId.trim() || !reason.trim()) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const operation = action === "approve" ? dshOperationPaths.approveOperatorSettlementBatch : dshOperationPaths.freezeOperatorSettlementBatch;
  const path = operation.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ batch: SettlementBatch }>>(operation.method, path, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function recordOperatorManualTransfer(batchId: string, payoutId: string, externalTransferReference: string, receiptDocumentId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ transfer: unknown }>> {
  if (!batchId.trim() || !payoutId.trim() || !externalTransferReference.trim() || !receiptDocumentId.trim()) throw new Error("DSH_MANUAL_TRANSFER_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.recordOperatorManualTransfer.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ transfer: unknown }>>(dshOperationPaths.recordOperatorManualTransfer.method, path, { payoutId, externalTransferReference, receiptDocumentId }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function transitionOperatorManualTransfer(transferId: string, action: "verify" | "reconcile", statementRowId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ transfer: unknown }>> {
  if (!transferId.trim() || (action === "reconcile" && !statementRowId.trim())) throw new Error("DSH_MANUAL_TRANSFER_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const operation = action === "verify" ? dshOperationPaths.verifyOperatorManualTransfer : dshOperationPaths.reconcileOperatorManualTransfer;
  const path = operation.path.replace("{transferId}", encodeURIComponent(transferId.trim()));
  return (await requestDshJson<Readonly<{ transfer: unknown }>>(operation.method, path, action === "verify" ? {} : { statementRowId }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function prepareOperatorPayout(payoutId: string, input: Readonly<{ reason: string; evidenceReference: string }>, context: JoiningCaseMutationContext): Promise<OperatorPayoutResponse> {
  if (!payoutId.trim() || !input.reason.trim() || !input.evidenceReference.trim()) throw new Error("DSH_PAYOUT_PREPARE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.prepareOperatorPayout.path.replace("{payoutId}", encodeURIComponent(payoutId.trim()));
  return (await requestDshJson<OperatorPayoutResponse>(dshOperationPaths.prepareOperatorPayout.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function approveOperatorPayout(payoutId: string, reason: string, context: JoiningCaseMutationContext): Promise<OperatorPayoutResponse> {
  if (!payoutId.trim() || !reason.trim()) throw new Error("DSH_PAYOUT_APPROVE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.approveOperatorPayout.path.replace("{payoutId}", encodeURIComponent(payoutId.trim()));
  return (await requestDshJson<OperatorPayoutResponse>(dshOperationPaths.approveOperatorPayout.method, path, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function cancelOperatorPayout(payoutId: string, reason: string, context: JoiningCaseMutationContext): Promise<OperatorPayoutResponse> {
  if (!payoutId.trim() || !reason.trim()) throw new Error("DSH_PAYOUT_CANCEL_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.cancelOperatorPayout.path.replace("{payoutId}", encodeURIComponent(payoutId.trim()));
  return (await requestDshJson<OperatorPayoutResponse>(dshOperationPaths.cancelOperatorPayout.method, path, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

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
