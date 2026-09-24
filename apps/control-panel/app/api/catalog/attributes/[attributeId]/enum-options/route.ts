import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreateCatalogAttributeEnumOptionRequest } from "@bthwani/dsh";
import { createCatalogAttributeEnumOption, dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogAttributeEnumOptions } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ attributeId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  try {
    const { attributeId } = await context.params;
    return NextResponse.json(await listCatalogAttributeEnumOptions(attributeId, { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "attribute option lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request, context: { params: Promise<{ attributeId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("platform_policies")) return errorResponse("FORBIDDEN", "Platform Policies permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["optionValue", "active", "ordinal"].includes(key)) || Object.keys(body).length !== 3 || typeof body.optionValue !== "string" || !body.optionValue.trim() || body.optionValue.trim().length > 128 || typeof body.active !== "boolean" || !Number.isInteger(body.ordinal) || Number(body.ordinal) < 0 || Number(body.ordinal) > 100) return errorResponse("INVALID_INPUT", "attribute option fields are invalid", 400);
  const input: CreateCatalogAttributeEnumOptionRequest = { optionValue: body.optionValue.trim(), active: body.active, ordinal: Number(body.ordinal) };
  try {
    const { attributeId } = await context.params;
    const result = await createCatalogAttributeEnumOption(attributeId, input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "attribute option creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
