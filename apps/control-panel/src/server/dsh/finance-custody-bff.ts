import { type CashCustodyRegistryResponse, dshOperationPaths, type PartnerCommissionReceivableRegistryResponse, type PartnerCommissionRemittanceRequest, type PartnerCommissionRemittanceResponse, type PartnerFinancialSummaryResponse, type StorePayoutRecipientListResponse } from "@bthwani/dsh";
import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, validateAttributedMutationContext } from "./dsh-transport";


type LegacyCODRecoveryResponse = import("@bthwani/dsh").LegacyCODRecoveryResponse;

export async function readOperatorLegacyCODRecoveryByPayment(paymentIntentId: string, context: DshOperatorReadContext): Promise<LegacyCODRecoveryResponse> {
  if (!paymentIntentId.trim() || paymentIntentId.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_LEGACY_COD_RECOVERY_READ_INVALID");
  const path = dshOperationPaths.readOperatorLegacyCODRecoveryByPayment.path.replace("{paymentIntentId}", encodeURIComponent(paymentIntentId.trim()));
  return (await requestDshJson<LegacyCODRecoveryResponse>(dshOperationPaths.readOperatorLegacyCODRecoveryByPayment.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function submitOperatorLegacyCODRecovery(paymentIntentId: string, evidenceDocumentId: string, context: JoiningCaseMutationContext): Promise<LegacyCODRecoveryResponse> {
  if (!paymentIntentId.trim() || paymentIntentId.length > 128 || !evidenceDocumentId.trim() || evidenceDocumentId.length > 128) throw new Error("DSH_LEGACY_COD_RECOVERY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  return (await requestDshJson<LegacyCODRecoveryResponse>(
    dshOperationPaths.submitOperatorLegacyCODRecovery.method, dshOperationPaths.submitOperatorLegacyCODRecovery.path,
    { paymentIntentId: paymentIntentId.trim(), evidenceDocumentId: evidenceDocumentId.trim() },
    { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() }
  )).payload;
}

export async function approveOperatorLegacyCODRecovery(reviewId: string, context: JoiningCaseMutationContext): Promise<LegacyCODRecoveryResponse> {
  if (!reviewId.trim() || reviewId.length > 128) throw new Error("DSH_LEGACY_COD_APPROVAL_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.approveOperatorLegacyCODRecovery.path.replace("{reviewId}", encodeURIComponent(reviewId.trim()));
  return (await requestDshJson<LegacyCODRecoveryResponse>(
    dshOperationPaths.approveOperatorLegacyCODRecovery.method, path, {},
    { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() }
  )).payload;
}
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
