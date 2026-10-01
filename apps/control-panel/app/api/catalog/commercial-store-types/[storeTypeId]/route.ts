import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { UpdateCommercialStoreTypeRequest } from "@bthwani/dsh";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateCommercialStoreType } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ storeTypeId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "Catalog permission is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["nameAr", "nameEn", "active", "expectedVersion", "reason"].includes(key)) || Object.keys(body).length !== 5 || typeof body.nameAr !== "string" || !body.nameAr.trim() || typeof body.nameEn !== "string" || !body.nameEn.trim() || typeof body.active !== "boolean" || typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) {
    return errorResponse("INVALID_INPUT", "nameAr, nameEn, active, expectedVersion and reason are required", 400);
  }
  const input: UpdateCommercialStoreTypeRequest = { nameAr: body.nameAr.trim(), nameEn: body.nameEn.trim(), active: body.active, expectedVersion: body.expectedVersion, reason: body.reason.trim() };
  try {
    const result = await updateCommercialStoreType((await context.params).storeTypeId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "commercial store type update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
