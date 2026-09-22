import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { MarketingPublicationRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, setMarketingPromotionPublication } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const expectedVersion = Number(request.headers.get("X-Expected-Version"));
  if (idempotencyKey.length < 8 || !Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse("INVALID_INPUT", "Idempotency-Key and X-Expected-Version are required", 400);
  const body = await request.json().catch(() => null) as { state?: unknown } | null;
  if (!body || (body.state !== "PUBLISHED" && body.state !== "PAUSED")) return errorResponse("INVALID_INPUT", "state must be PUBLISHED or PAUSED", 400);
  const { promotionId } = await params;
  const input: MarketingPublicationRequest = { state: body.state };
  try {
    const result = await setMarketingPromotionPublication(promotionId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "promotion publication failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
