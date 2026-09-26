import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { UpdateCommerceVerticalRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateCatalogVertical } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ verticalId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "Catalog permission is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["nameAr", "nameEn", "catalogModel", "active", "expectedVersion", "reason"];
  if (!body || Object.keys(body).length !== allowed.length || Object.keys(body).some((key) => !allowed.includes(key)) || typeof body.nameAr !== "string" || typeof body.nameEn !== "string" || (body.catalogModel !== "SHARED_CATALOG" && body.catalogModel !== "STORE_LOCAL_CATALOG") || typeof body.active !== "boolean" || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) return errorResponse("INVALID_INPUT", "vertical update facts are invalid", 400);
  try {
    const { verticalId } = await context.params;
    const input: UpdateCommerceVerticalRequest = { nameAr: body.nameAr.trim(), nameEn: body.nameEn.trim(), catalogModel: body.catalogModel, active: body.active, expectedVersion: Number(body.expectedVersion), reason: body.reason.trim() };
    const result = await updateCatalogVertical(verticalId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog vertical update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
