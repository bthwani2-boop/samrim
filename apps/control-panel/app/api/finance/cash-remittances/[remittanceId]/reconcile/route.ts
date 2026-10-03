import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, reconcileOperatorCashRemittance } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ remittanceId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);

  const { remittanceId } = await context.params;
  const body = await request.json().catch(() => null) as { evidenceDocumentId?: unknown } | null;
  if (!remittanceId.trim() || remittanceId.length > 128 || !body || typeof body.evidenceDocumentId !== "string" || !body.evidenceDocumentId.trim() || body.evidenceDocumentId.length > 128) {
    return errorResponse("INVALID_INPUT", "بيانات مطابقة توريد العهدة غير صالحة", 400);
  }

  try {
    const result = await reconcileOperatorCashRemittance(remittanceId, body.evidenceDocumentId, {
      operatorActorId: identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID(),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "تعذر إتمام مطابقة توريد العهدة", 500);
    return errorResponse(dshErrorPayload(error).code, dshErrorPayload(error).message, dshHttpStatus(error));
  }
}
