import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { UpdateStoreTypeCommissionDefaultRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorStoreTypeCommissionDefaults, updateOperatorStoreTypeCommissionDefault } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);
  const commercialStoreTypeId = new URL(request.url).searchParams.get("commercialStoreTypeId")?.trim() ?? "";
  if (!commercialStoreTypeId || commercialStoreTypeId.length > 128) return errorResponse("INVALID_INPUT", "commercialStoreTypeId is required", 400);
  try {
    const result = await readOperatorStoreTypeCommissionDefaults(commercialStoreTypeId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store commission defaults request failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = new Set(["commercialStoreTypeId", "fulfillmentMode", "suggestedCommissionRateBps", "expectedDefaultVersion", "reason"]);
  const commercialStoreTypeId = typeof body?.commercialStoreTypeId === "string" ? body.commercialStoreTypeId.trim() : "";
  const fulfillmentMode = body?.fulfillmentMode;
  const suggestedCommissionRateBps = body?.suggestedCommissionRateBps;
  const expectedDefaultVersion = body?.expectedDefaultVersion;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const validMode = fulfillmentMode === "BTHWANI_CAPTAIN" || fulfillmentMode === "PARTNER_CAPTAIN" || fulfillmentMode === "CUSTOMER_PICKUP";
  if (!body || Object.keys(body).some((key) => !allowed.has(key)) || !commercialStoreTypeId || commercialStoreTypeId.length > 128 || !validMode || !Number.isInteger(suggestedCommissionRateBps) || Number(suggestedCommissionRateBps) < 0 || Number(suggestedCommissionRateBps) > 10000 || !Number.isInteger(expectedDefaultVersion) || Number(expectedDefaultVersion) < 0 || Array.from(reason).length < 8 || Array.from(reason).length > 500) {
    return errorResponse("INVALID_INPUT", "Store type commission default fields are invalid", 400);
  }
  const input: UpdateStoreTypeCommissionDefaultRequest = {
    fulfillmentMode: fulfillmentMode as UpdateStoreTypeCommissionDefaultRequest["fulfillmentMode"],
    suggestedCommissionRateBps: Number(suggestedCommissionRateBps),
    expectedDefaultVersion: Number(expectedDefaultVersion),
    reason,
  };
  try {
    const result = await updateOperatorStoreTypeCommissionDefault(commercialStoreTypeId, input, {
      operatorActorId: identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store commission default update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
