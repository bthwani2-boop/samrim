import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorWalletProviders, readOperatorSettlementBatch, registerOperatorSettlementStatement } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const body = await request.json().catch(() => null) as { batchId?: unknown; providerKey?: unknown; currency?: unknown; periodStart?: unknown; periodEnd?: unknown; evidenceDocumentId?: unknown } | null;
  if (!body || (body.batchId !== undefined && (typeof body.batchId !== "string" || !body.batchId.trim())) || typeof body.providerKey !== "string" || !body.providerKey.trim() || body.currency !== "YER" || typeof body.periodStart !== "string" || !body.periodStart || typeof body.periodEnd !== "string" || !body.periodEnd || typeof body.evidenceDocumentId !== "string" || !body.evidenceDocumentId.trim()) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات كشف المحفظة غير مكتملة" } }, { status: 400 });
  try {
    const context = { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID() };
    let providerKey = body.providerKey.trim();
    const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    if (batchId) {
      const { batch } = await readOperatorSettlementBatch(batchId, context);
      if (!batch.providerKey.trim() || providerKey !== batch.providerKey) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "مزوّد الكشف يجب أن يطابق مزوّد الدفعة المعتمد" } }, { status: 400 });
      providerKey = batch.providerKey;
    } else {
      const { walletProviders } = await listOperatorWalletProviders(false, context);
      if (!walletProviders.some((provider) => provider.key === providerKey && provider.active)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "اختر مزوّد محفظة نشطًا من السجل المعتمد" } }, { status: 400 });
    }
    const result = await registerOperatorSettlementStatement({ ...(batchId ? { batchId } : {}), providerKey, currency: "YER", periodStart: body.periodStart, periodEnd: body.periodEnd, evidenceDocumentId: body.evidenceDocumentId }, { ...context, idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تسجيل كشف المحفظة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
