import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { CreateCatalogCategoryRequest } from "@bthwani/dsh";
import { createCatalogCategory, dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogCategories } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verticalId = params.get("verticalId")?.trim() ?? "";
  const includeInactive = params.get("includeInactive") === "true";
  const query = params.get("query")?.trim() ?? "";
  const status = params.get("status")?.trim() ?? "";
  if (!verticalId) return errorResponse("INVALID_INPUT", "verticalId is required", 400);
  if (query.length > 160 || (status && !["all", "active", "inactive"].includes(status))) return errorResponse("INVALID_INPUT", "category search or status filter is invalid", 400);
  try {
    if (!includeInactive && !query && !status) return NextResponse.json(await listCatalogCategories(verticalId), { headers: { "Cache-Control": "no-store" } });
    const identity = await readOperatorSession();
    if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
    if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
    const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
    if (permissionDenied) return permissionDenied;
    return NextResponse.json(await listCatalogCategories(verticalId, includeInactive, { operatorActorId: identity.subject }, query, status), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog category lookup failed", 500);
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
  const keys = body ? Object.keys(body) : [];
  const hasOnlyAllowedKeys = keys.every((key) => ["id", "verticalId", "parentCategoryId", "nameAr", "nameEn", "active", "reason"].includes(key));
  if (!body || !hasOnlyAllowedKeys || keys.length < 5 || keys.length > 7 || (body.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) || typeof body.verticalId !== "string" || typeof body.nameAr !== "string" || typeof body.nameEn !== "string" || typeof body.active !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500 || !body.verticalId.trim() || !body.nameAr.trim() || !body.nameEn.trim() || (body.parentCategoryId !== undefined && body.parentCategoryId !== null && typeof body.parentCategoryId !== "string")) {
    return errorResponse("INVALID_INPUT", "verticalId, nameAr, nameEn, active and reason are required; DSH generates id automatically", 400);
  }
  const input: CreateCatalogCategoryRequest = { ...(typeof body.id === "string" ? { id: body.id.trim() } : {}), verticalId: body.verticalId.trim(), parentCategoryId: typeof body.parentCategoryId === "string" && body.parentCategoryId.trim() ? body.parentCategoryId.trim() : null, nameAr: body.nameAr.trim(), nameEn: body.nameEn.trim(), active: body.active, reason: body.reason.trim() };
  try {
    const result = await createCatalogCategory(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog category creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
