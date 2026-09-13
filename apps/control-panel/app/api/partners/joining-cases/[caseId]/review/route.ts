import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, reviewJoiningCase } from "../../../../../../src/server/dsh/dsh-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["decision", "correctionReason", "expectedVersion"].includes(key)) || typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || (body.decision !== "approved" && body.decision !== "needs_correction") || (body.correctionReason !== undefined && typeof body.correctionReason !== "string")) return errorResponse("INVALID_INPUT", "decision and expectedVersion are required", 400);
  try {
    const { caseId } = await context.params;
    const result = await reviewJoiningCase(caseId, { decision: body.decision, ...(typeof body.correctionReason === "string" ? { correctionReason: body.correctionReason } : {}) }, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion: body.expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case review failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
