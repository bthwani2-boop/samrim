import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { CreateCommerceVerticalRequest } from "@bthwani/dsh";
import { createCatalogVertical, dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogVerticals } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  try {
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
    return NextResponse.json(await listCatalogVerticals({ operatorActorId: identity.subject }, includeInactive), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog vertical lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "Catalog permission is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["id", "nameAr", "nameEn", "catalogModel", "active", "reason"].includes(key)) || (Object.keys(body).length !== 5 && Object.keys(body).length !== 6) || (body.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) || typeof body.nameAr !== "string" || typeof body.nameEn !== "string" || (body.catalogModel !== "SHARED_CATALOG" && body.catalogModel !== "STORE_LOCAL_CATALOG") || typeof body.active !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500 || !body.nameAr.trim() || !body.nameEn.trim()) {
    return errorResponse("INVALID_INPUT", "nameAr, nameEn, catalogModel, active and reason are required; DSH generates id automatically", 400);
  }
  const input: CreateCommerceVerticalRequest = { ...(typeof body.id === "string" ? { id: body.id.trim() } : {}), nameAr: body.nameAr.trim(), nameEn: body.nameEn.trim(), catalogModel: body.catalogModel, active: body.active, reason: body.reason.trim() };
  try {
    const result = await createCatalogVertical(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog vertical creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
