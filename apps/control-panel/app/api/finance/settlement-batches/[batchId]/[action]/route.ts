import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, recordOperatorManualTransfer, transitionOperatorSettlementBatch } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request, context: { params: Promise<{ batchId: string; action: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { batchId, action } = await context.params;
  const body = await request.json().catch(() => null) as { reason?: unknown; payoutId?: unknown; externalTransferReference?: unknown; receiptDocumentId?: unknown } | null;
  const contextValue = { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() };
  try {
    if ((action === "approve" || action === "freeze") && body && typeof body.reason === "string") return NextResponse.json(await transitionOperatorSettlementBatch(batchId, action, body.reason, contextValue), { headers: { "Cache-Control": "no-store" } });
    if (action === "transfers" && body && typeof body.payoutId === "string" && typeof body.externalTransferReference === "string" && typeof body.receiptDocumentId === "string") return NextResponse.json(await recordOperatorManualTransfer(batchId, body.payoutId, body.externalTransferReference, body.receiptDocumentId, contextValue), { status: 201, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "إجراء الدفعة أو بيانات التحويل غير صالحة" } }, { status: 400 });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تنفيذ إجراء الدفعة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
