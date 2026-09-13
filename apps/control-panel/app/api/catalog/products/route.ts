import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { CreateCentralProductRequest } from "@bthwani/dsh";
import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { createCentralProduct, dshErrorPayload, dshHttpStatus, isDshClientError, listCentralProducts } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  try {
    const products = await listCentralProducts(new URL(request.url).searchParams.get("q")?.trim() ?? "", { operatorActorId: identity.subject });
    return NextResponse.json(products, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "central Product lookup failed", 500);
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
  if (!body || typeof body.canonicalName !== "string" || !["piece", "kg"].includes(String(body.sellUnit))) return errorResponse("INVALID_INPUT", "canonicalName and sellUnit are required", 400);
  const input: CreateCentralProductRequest = {
    canonicalName: body.canonicalName.trim(),
    sellUnit: body.sellUnit as CreateCentralProductRequest["sellUnit"],
    ...(typeof body.brand === "string" && body.brand.trim() ? { brand: body.brand.trim() } : {}),
    ...(typeof body.barcode === "string" && body.barcode.trim() ? { barcode: body.barcode.trim() } : {}),
    ...(typeof body.canonicalImageUrl === "string" && body.canonicalImageUrl.trim() ? { canonicalImageUrl: body.canonicalImageUrl.trim() } : {}),
  };
  try {
    const result = await createCentralProduct(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "central Product creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
