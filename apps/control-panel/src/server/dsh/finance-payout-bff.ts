import { type ActorLegalName, type BeneficiaryPayoutState, type BeneficiaryPayoutStateResponse, type CreateCustomerWithdrawalIntakeRequest, type CustomerWithdrawalDecisionRequest, type CustomerWithdrawalIntakeListResponse, type CustomerWithdrawalIntakeResponse, dshOperationPaths, type OfficialWalletDestination, type PayoutRequest, type SubmitActorLegalNameRequest, type VerifyActorLegalNameRequest } from "@bthwani/dsh";
import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, requestDshMultipart, validateAttributedMutationContext } from "./dsh-transport";
import { OperatorFinanceEvidenceResponse } from "./finance-settlement-bff";


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
