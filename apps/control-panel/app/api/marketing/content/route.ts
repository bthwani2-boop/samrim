import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreateDiscoveryContentRequest } from "@bthwani/dsh";
import { createMarketingContent, dshErrorPayload, dshHttpStatus, isDshClientError, listMarketingContent } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  try {
    return NextResponse.json(await listMarketingContent({ operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery content lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || !body.id.trim() || !["BANNER", "CAROUSEL", "SHORT_FORM"].includes(String(body.kind)) || typeof body.titleAr !== "string" || !body.titleAr.trim() || !["STORE", "PRODUCT", "CATEGORY", "PROMOTION", "INFO"].includes(String(body.targetType)) || typeof body.startsAt !== "string" || !body.startsAt.trim() || !Number.isSafeInteger(body.ordinal) || Number(body.ordinal) < 0) return errorResponse("INVALID_INPUT", "content id, kind, title, target type, startsAt and ordinal are required", 400);
  const targetType = body.targetType as CreateDiscoveryContentRequest["targetType"];
  const input: CreateDiscoveryContentRequest = {
    id: body.id.trim(),
    kind: body.kind as CreateDiscoveryContentRequest["kind"],
    titleAr: body.titleAr.trim(),
    targetType,
    startsAt: body.startsAt.trim(),
    ordinal: Number(body.ordinal),
    ...(typeof body.bodyAr === "string" && body.bodyAr.trim() ? { bodyAr: body.bodyAr.trim() } : {}),
    ...(typeof body.mediaUri === "string" && body.mediaUri.trim() ? { mediaUri: body.mediaUri.trim() } : {}),
    ...(typeof body.targetId === "string" && body.targetId.trim() ? { targetId: body.targetId.trim() } : {}),
    ...(typeof body.serviceCityId === "string" && body.serviceCityId.trim() ? { serviceCityId: body.serviceCityId.trim() } : {}),
    ...(typeof body.endsAt === "string" && body.endsAt.trim() ? { endsAt: body.endsAt.trim() } : {}),
  };
  try {
    const result = await createMarketingContent(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery content creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
