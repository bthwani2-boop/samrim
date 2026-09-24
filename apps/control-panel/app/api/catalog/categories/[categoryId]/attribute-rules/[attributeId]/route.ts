import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { UpsertCatalogAttributeRuleRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, upsertCatalogCategoryAttributeRule } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, context: { params: Promise<{ categoryId: string; attributeId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("platform_policies")) return errorResponse("FORBIDDEN", "Platform Policies permission is required", 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["required", "filterable", "variantAxis", "expectedVersion", "reason"].includes(key)) || Object.keys(body).length !== 5 || typeof body.required !== "boolean" || body.filterable !== false || typeof body.variantAxis !== "boolean" || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) return errorResponse("INVALID_INPUT", "attribute rule fields are invalid", 400);
  const input: UpsertCatalogAttributeRuleRequest = { required: body.required, filterable: false, variantAxis: body.variantAxis, expectedVersion: Number(body.expectedVersion), reason: body.reason.trim() };
  try {
    const { categoryId, attributeId } = await context.params;
    const result = await upsertCatalogCategoryAttributeRule(categoryId, attributeId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "category attribute rule update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
