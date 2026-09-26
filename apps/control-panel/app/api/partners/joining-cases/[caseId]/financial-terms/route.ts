import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { bindJoiningCaseFinancialTerms, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const partnerPermissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (partnerPermissionDenied) return partnerPermissionDenied;
  if (!identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required to bind partner terms", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["expectedVersion", "expectedTermsPolicyVersion"].includes(key)) || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || typeof body.expectedTermsPolicyVersion !== "string" || body.expectedTermsPolicyVersion.trim().length < 1 || body.expectedTermsPolicyVersion.length > 128) {
    return errorResponse("INVALID_INPUT", "expected case and policy versions are required", 400);
  }
  try {
    const { caseId } = await context.params;
    const result = await bindJoiningCaseFinancialTerms(caseId, { expectedTermsPolicyVersion: body.expectedTermsPolicyVersion.trim() }, {
      operatorActorId: identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      expectedVersion: Number(body.expectedVersion),
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case financial terms binding failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
