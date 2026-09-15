import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { CreateCatalogProductRequest } from "@bthwani/dsh";
import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { createCatalogProduct, dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogProducts } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  try {
    const products = await listCatalogProducts(new URL(request.url).searchParams.get("q")?.trim() ?? "", new URL(request.url).searchParams.get("verticalId")?.trim() ?? "", { operatorActorId: identity.subject });
    return NextResponse.json(products, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog Product lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.canonicalName !== "string" || typeof body.verticalId !== "string" || !["SHARED", "STORE_SCOPED"].includes(String(body.scope)) || !["piece", "kg"].includes(String(body.sellUnit)) || !Array.isArray(body.categoryIds) || body.categoryIds.length < 1) return errorResponse("INVALID_INPUT", "canonicalName, verticalId, scope, categoryIds and sellUnit are required", 400);
  const identifierType = ["GTIN", "EAN", "UPC", "SKU"].includes(String(body.identifierType)) ? String(body.identifierType) as NonNullable<CreateCatalogProductRequest["identifierType"]> : undefined;
  const input: CreateCatalogProductRequest = {
    canonicalName: body.canonicalName.trim(),
    verticalId: body.verticalId.trim(),
    scope: body.scope as CreateCatalogProductRequest["scope"],
    sellUnit: body.sellUnit as CreateCatalogProductRequest["sellUnit"],
    categoryIds: body.categoryIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean),
    ...(typeof body.variantTitle === "string" && body.variantTitle.trim() ? { variantTitle: body.variantTitle.trim() } : {}),
    ...(typeof body.brand === "string" && body.brand.trim() ? { brand: body.brand.trim() } : {}),
    ...(identifierType ? { identifierType } : {}),
    ...(typeof body.identifierValue === "string" && body.identifierValue.trim() ? { identifierValue: body.identifierValue.trim() } : {}),
    ...(typeof body.imageUri === "string" && body.imageUri.trim() ? { imageUri: body.imageUri.trim() } : {}),
  };
  try {
    const result = await createCatalogProduct(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog Product creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
