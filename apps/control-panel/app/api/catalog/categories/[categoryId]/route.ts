import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { UpdateCatalogCategoryRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateCatalogCategory } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("platform_policies")) return errorResponse("FORBIDDEN", "Platform Policies permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["parentCategoryId", "nameAr", "nameEn", "active", "expectedVersion", "reason"];
  if (!body || Object.keys(body).length !== allowed.length || Object.keys(body).some((key) => !allowed.includes(key)) || typeof body.parentCategoryId !== "string" || typeof body.nameAr !== "string" || typeof body.nameEn !== "string" || typeof body.active !== "boolean" || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) return errorResponse("INVALID_INPUT", "category update facts are invalid", 400);
  try {
    const { categoryId } = await context.params;
    const input: UpdateCatalogCategoryRequest = { parentCategoryId: typeof body.parentCategoryId === "string" ? body.parentCategoryId.trim() : "", nameAr: body.nameAr.trim(), nameEn: body.nameEn.trim(), active: body.active, expectedVersion: Number(body.expectedVersion), reason: body.reason.trim() };
    const result = await updateCatalogCategory(categoryId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog category update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
