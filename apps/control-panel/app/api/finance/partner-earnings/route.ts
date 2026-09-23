import { NextResponse } from "next/server";

import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPartnerFinancialSummary, recordOperatorPartnerCommissionRemittance } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const correlationId = request.headers.get("X-Correlation-ID")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || correlationId.length < 8 || correlationId.length > 128) return errorResponse("INVALID_INPUT", "mutation identifiers are required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fields = ["partnerActorId", "amountMinor", "remittanceReference", "evidenceReference"];
  if (!body || Object.keys(body).length !== fields.length || Object.keys(body).some((key) => !fields.includes(key))) return errorResponse("INVALID_INPUT", "partner and remittance evidence are required", 400);
  if (typeof body.partnerActorId !== "string" || !body.partnerActorId.trim() || body.partnerActorId.trim().length > 128 || typeof body.amountMinor !== "number" || !Number.isSafeInteger(body.amountMinor) || body.amountMinor <= 0 || typeof body.remittanceReference !== "string" || !body.remittanceReference.trim() || body.remittanceReference.trim().length > 128 || typeof body.evidenceReference !== "string" || !body.evidenceReference.trim() || body.evidenceReference.trim().length > 512) return errorResponse("INVALID_INPUT", "remittance amount and references are invalid", 400);
  try {
    const result = await recordOperatorPartnerCommissionRemittance(body.partnerActorId.trim(), { amountMinor: body.amountMinor, remittanceReference: body.remittanceReference.trim(), evidenceReference: body.evidenceReference.trim() }, { operatorActorId: identity.subject, idempotencyKey, correlationId });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "commission remittance recording failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);
  const partnerActorId = new URL(request.url).searchParams.get("partnerActorId")?.trim() ?? "";
  if (!partnerActorId) return errorResponse("INVALID_INPUT", "partnerActorId is required", 400);
  try {
    const result = await readOperatorPartnerFinancialSummary(partnerActorId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "partner earnings read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
