import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { UpdateCatalogAttributeEnumOptionRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateCatalogAttributeEnumOption } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ attributeId: string; optionValue: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "Catalog permission is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fields = ["active", "ordinal", "expectedVersion", "reason"];
  if (!body || Object.keys(body).length !== fields.length || Object.keys(body).some((key) => !fields.includes(key)) || typeof body.active !== "boolean" || !Number.isInteger(body.ordinal) || Number(body.ordinal) < 0 || Number(body.ordinal) > 100 || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) return errorResponse("INVALID_INPUT", "attribute option update facts are invalid", 400);
  try {
    const { attributeId, optionValue } = await context.params;
    const input: UpdateCatalogAttributeEnumOptionRequest = { active: body.active, ordinal: Number(body.ordinal), expectedVersion: Number(body.expectedVersion), reason: body.reason.trim() };
    const result = await updateCatalogAttributeEnumOption(attributeId, optionValue, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "attribute option update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
