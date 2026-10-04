import { NextResponse } from "next/server";

import { decideOperatorStoreCommercialAgreement, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string; agreementId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const correlationId = request.headers.get("X-Correlation-ID")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || correlationId.length < 8 || correlationId.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key and X-Correlation-ID are required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => key !== "expectedAgreementVersion" && key !== "decision" && key !== "reason") ||
    !Number.isInteger(body.expectedAgreementVersion) || Number(body.expectedAgreementVersion) < 1 ||
    (body.decision !== "APPROVE" && body.decision !== "REJECT") || typeof body.reason !== "string" || Array.from(body.reason.trim()).length < 8 || Array.from(body.reason.trim()).length > 500) {
    return errorResponse("INVALID_INPUT", "commercial agreement decision fields are invalid", 400);
  }

  const { storeId, agreementId } = await context.params;
  if (!storeId?.trim() || storeId.length > 128 || !agreementId?.trim() || agreementId.length > 128) return errorResponse("INVALID_INPUT", "store and agreement identifiers are invalid", 400);
  try {
    const result = await decideOperatorStoreCommercialAgreement(storeId, agreementId, body.decision, Number(body.expectedAgreementVersion), body.reason, {
      operatorActorId: identity.subject,
      correlationId,
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store commercial agreement decision failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
