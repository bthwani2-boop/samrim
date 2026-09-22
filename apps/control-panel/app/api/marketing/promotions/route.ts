import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreatePromotionRequest } from "@bthwani/dsh";
import { createMarketingPromotion, dshErrorPayload, dshHttpStatus, isDshClientError, listMarketingPromotions } from "../../../../src/server/dsh/dsh-bff";
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
    return NextResponse.json(await listMarketingPromotions({ operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "promotion lookup failed", 500);
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
  if (!body || typeof body.id !== "string" || !body.id.trim() || typeof body.code !== "string" || !body.code.trim() || typeof body.nameAr !== "string" || !body.nameAr.trim() || !["PERCENTAGE", "FIXED"].includes(String(body.kind)) || !Number.isSafeInteger(body.valueMinor) || Number(body.valueMinor) <= 0 || body.fundingSource !== "MERCHANT" || typeof body.startsAt !== "string" || !body.startsAt.trim()) return errorResponse("INVALID_INPUT", "promotion id, code, name, kind, value, fundingSource and startsAt are required", 400);
  const input: CreatePromotionRequest = {
    id: body.id.trim(),
    code: body.code.trim().toUpperCase(),
    nameAr: body.nameAr.trim(),
    kind: body.kind as CreatePromotionRequest["kind"],
    valueMinor: Number(body.valueMinor),
    fundingSource: "MERCHANT",
    startsAt: body.startsAt.trim(),
    ...(typeof body.descriptionAr === "string" && body.descriptionAr.trim() ? { descriptionAr: body.descriptionAr.trim() } : {}),
    ...(Number.isSafeInteger(body.maxDiscountMinor) && Number(body.maxDiscountMinor) > 0 ? { maxDiscountMinor: Number(body.maxDiscountMinor) } : {}),
    ...(typeof body.storeId === "string" && body.storeId.trim() ? { storeId: body.storeId.trim() } : {}),
    ...(typeof body.serviceCityId === "string" && body.serviceCityId.trim() ? { serviceCityId: body.serviceCityId.trim() } : {}),
    ...(typeof body.endsAt === "string" && body.endsAt.trim() ? { endsAt: body.endsAt.trim() } : {}),
    ...(Number.isSafeInteger(body.redemptionLimit) && Number(body.redemptionLimit) > 0 ? { redemptionLimit: Number(body.redemptionLimit) } : {}),
  };
  try {
    const result = await createMarketingPromotion(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "promotion creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
