import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { UpdateCentralProductRequest } from "@bthwani/dsh";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateCentralProduct } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const expectedVersion = Number(request.headers.get("X-Expected-Version")?.trim());
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse("INVALID_INPUT", "Idempotency-Key and X-Expected-Version are required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.canonicalName !== "string" || typeof body.active !== "boolean") return errorResponse("INVALID_INPUT", "canonicalName and active are required", 400);
  const input: UpdateCentralProductRequest = {
    canonicalName: body.canonicalName.trim(),
    active: body.active,
    ...(typeof body.brand === "string" && body.brand.trim() ? { brand: body.brand.trim() } : {}),
    ...(typeof body.barcode === "string" && body.barcode.trim() ? { barcode: body.barcode.trim() } : {}),
    ...(typeof body.canonicalImageUrl === "string" && body.canonicalImageUrl.trim() ? { canonicalImageUrl: body.canonicalImageUrl.trim() } : {}),
  };
  try {
    const { productId } = await context.params;
    const result = await updateCentralProduct(productId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "central Product update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
