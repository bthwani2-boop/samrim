import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, exportOperatorSettlementBatch, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { batchId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات تصدير الدفعة غير صالحة" } }, { status: 400 });
  const mutationContext = { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() };
  try {
    return NextResponse.json(await exportOperatorSettlementBatch(batchId, mutationContext), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر إنشاء ملف تنفيذ الدفعة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
