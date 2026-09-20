import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { ReplaceCatalogProductMediaRequest, UpdateCatalogProductRequest } from "@bthwani/dsh";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, replaceCatalogProductMedia, updateCatalogProduct } from "../../../../../src/server/dsh/dsh-bff";
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
  if (!body || typeof body.canonicalName !== "string" || typeof body.verticalId !== "string" || body.scope !== "SHARED" || typeof body.active !== "boolean") return errorResponse("INVALID_INPUT", "canonicalName, verticalId, shared scope and active are required", 400);
  const input: UpdateCatalogProductRequest = {
    canonicalName: body.canonicalName.trim(),
    active: body.active,
    verticalId: body.verticalId.trim(),
    scope: "SHARED",
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

export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const expectedVersion = Number(request.headers.get("X-Expected-Version")?.trim());
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse("INVALID_INPUT", "Idempotency-Key and X-Expected-Version are required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const rawMedia = body?.media;
  if (!body || !Array.isArray(rawMedia) || rawMedia.length > 21) return errorResponse("INVALID_INPUT", "media must be an array with at most 21 items", 400);
  const media: Array<ReplaceCatalogProductMediaRequest["media"][number]> = [];
  for (const item of rawMedia) {
    if (!item || typeof item !== "object") return errorResponse("INVALID_INPUT", "media items are invalid", 400);
    const value = item as Record<string, unknown>;
    if (typeof value.uri !== "string" || typeof value.role !== "string" || !Number.isInteger(value.ordinal)) return errorResponse("INVALID_INPUT", "media items require uri, role and ordinal", 400);
    media.push({ uri: value.uri.trim(), role: value.role as "primary" | "gallery", ordinal: value.ordinal as number });
  }
  try {
    const { productId } = await context.params;
    const result = await replaceCatalogProductMedia(productId, { media }, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog Product media update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
