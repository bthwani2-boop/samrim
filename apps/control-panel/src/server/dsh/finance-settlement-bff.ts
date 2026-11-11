import { dshOperationPaths, type FinanceEvidenceDocument, type SettlementBatch, type SettlementBatchExport } from "@bthwani/dsh";
import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshFile, requestDshJson, requestDshMultipart, validateAttributedMutationContext } from "./dsh-transport";


export type FinanceEvidencePurpose = "TRANSFER_RECEIPT" | "SETTLEMENT_STATEMENT" | "CUSTOMER_WITHDRAWAL_REQUEST" | "CAPTAIN_COD_LEGACY_RECOVERY";
export type OperatorFinanceEvidenceResponse = Readonly<{ document: FinanceEvidenceDocument }>;
export type OperatorSettlementStatement = Readonly<{ id: string; batchId?: string | null; providerKey: string; currency: "YER"; periodStart: string; periodEnd: string; evidenceDocumentId: string; filename: string; artifactSHA256: string; uploadedBy: string; createdAt: string }>;
export type OperatorSettlementStatementRow = Readonly<{ id: string; statementId: string; rowSequence: number; externalTransferReference: string; amountMinor: number; currency: "YER"; transactionAt: string; recordedBy: string; matchedTransferId?: string | null }>;

export async function uploadOperatorFinanceEvidence(purpose: FinanceEvidencePurpose, file: File, context: JoiningCaseMutationContext): Promise<OperatorFinanceEvidenceResponse> {
  if (!(purpose === "TRANSFER_RECEIPT" || purpose === "SETTLEMENT_STATEMENT" || purpose === "CUSTOMER_WITHDRAWAL_REQUEST" || purpose === "CAPTAIN_COD_LEGACY_RECOVERY") || !file.size || file.size > 10 * 1024 * 1024 || !file.name.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FINANCE_EVIDENCE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", file, file.name);
  return (await requestDshMultipart<OperatorFinanceEvidenceResponse>(dshOperationPaths.uploadOperatorFinanceEvidence.method, dshOperationPaths.uploadOperatorFinanceEvidence.path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

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
