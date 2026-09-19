import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, reviewCatalogProposal } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { state?: unknown; reason?: unknown; expectedVersion?: unknown } | null;
  const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : NaN;
  if (!["approved", "rejected", "needs_correction"].includes(String(body?.state)) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || idempotencyKey.length < 8) return errorResponse("INVALID_INPUT", "state, expectedVersion and Idempotency-Key are required", 400);
  try {
    const { proposalId } = await context.params;
    const input: { state: "approved" | "rejected" | "needs_correction"; reason?: string } = { state: body?.state as "approved" | "rejected" | "needs_correction" };
    if (typeof body?.reason === "string") input.reason = body.reason.trim();
    const result = await reviewCatalogProposal(proposalId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "proposal review failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
