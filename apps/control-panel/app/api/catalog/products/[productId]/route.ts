import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { UpdateCatalogProductRequest } from "@bthwani/dsh";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateCatalogProduct } from "../../../../../src/server/dsh/dsh-bff";
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
  if (!body || typeof body.canonicalName !== "string" || typeof body.verticalId !== "string" || !["SHARED", "STORE_SCOPED"].includes(String(body.scope)) || typeof body.active !== "boolean") return errorResponse("INVALID_INPUT", "canonicalName, verticalId, scope and active are required", 400);
  const input: UpdateCatalogProductRequest = {
    canonicalName: body.canonicalName.trim(),
    active: body.active,
    verticalId: body.verticalId.trim(),
    scope: body.scope as UpdateCatalogProductRequest["scope"],
    ...(typeof body.brand === "string" && body.brand.trim() ? { brand: body.brand.trim() } : {}),
  };
  try {
    const { productId } = await context.params;
    const result = await updateCatalogProduct(productId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog Product update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
