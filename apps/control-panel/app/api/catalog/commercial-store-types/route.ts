import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { CreateCommercialStoreTypeRequest } from "@bthwani/dsh";
import { createCommercialStoreType, dshErrorPayload, dshHttpStatus, isDshClientError, listCommercialStoreTypes } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorizedOperator(requireCatalogPermission = true) {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "Catalog permission is required", 403) } as const;
  if (requireCatalogPermission) {
    const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
    if (permissionDenied) return { error: permissionDenied } as const;
  }
  return { identity } as const;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const verticalId = query.get("verticalId")?.trim() ?? "";
  const includeInactive = query.get("includeInactive") === "true";
  const auth = await authorizedOperator(includeInactive);
  if ("error" in auth) return auth.error;
  if (!verticalId) return errorResponse("INVALID_INPUT", "verticalId is required", 400);
  try {
    return NextResponse.json(await listCommercialStoreTypes({ operatorActorId: auth.identity.subject }, verticalId, includeInactive), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "commercial store type lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const auth = await authorizedOperator();
  if ("error" in auth) return auth.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["id", "verticalId", "nameAr", "nameEn", "active", "reason"];
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || (Object.keys(body).length !== 5 && Object.keys(body).length !== 6) || (body.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) || typeof body.verticalId !== "string" || !body.verticalId.trim() || typeof body.nameAr !== "string" || !body.nameAr.trim() || typeof body.nameEn !== "string" || !body.nameEn.trim() || typeof body.active !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) {
    return errorResponse("INVALID_INPUT", "verticalId, nameAr, nameEn, active and reason are required", 400);
  }
  const input: CreateCommercialStoreTypeRequest = { ...(typeof body.id === "string" ? { id: body.id.trim() } : {}), verticalId: body.verticalId.trim(), nameAr: body.nameAr.trim(), nameEn: body.nameEn.trim(), active: body.active, reason: body.reason.trim() };
  try {
    const result = await createCommercialStoreType(input, { operatorActorId: auth.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "commercial store type creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
