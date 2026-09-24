import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreateCatalogAttributeDefinitionRequest } from "@bthwani/dsh";
import { createCatalogAttributeDefinition, dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogAttributeDefinitions } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const params = new URL(request.url).searchParams;
  const verticalId = params.get("verticalId")?.trim() ?? "";
  if (!verticalId) return errorResponse("INVALID_INPUT", "verticalId is required", 400);
  try {
    return NextResponse.json(await listCatalogAttributeDefinitions(verticalId, params.get("includeInactive") === "true", { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog attribute lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("platform_policies")) return errorResponse("FORBIDDEN", "Platform Policies permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kinds = ["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "ENUM", "MEASUREMENT", "DATE"];
  if (!body || Object.keys(body).some((key) => !["verticalId", "code", "nameAr", "valueKind", "active"].includes(key)) || Object.keys(body).length !== 5 || typeof body.verticalId !== "string" || !body.verticalId.trim() || typeof body.code !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(body.code) || typeof body.nameAr !== "string" || body.nameAr.trim().length < 2 || body.nameAr.trim().length > 160 || typeof body.valueKind !== "string" || !kinds.includes(body.valueKind) || typeof body.active !== "boolean") return errorResponse("INVALID_INPUT", "attribute definition fields are invalid", 400);
  const input: CreateCatalogAttributeDefinitionRequest = { id: `attr_${randomUUID().replaceAll("-", "")}`, verticalId: body.verticalId.trim(), code: body.code.trim(), nameAr: body.nameAr.trim(), valueKind: body.valueKind as CreateCatalogAttributeDefinitionRequest["valueKind"], active: body.active };
  try {
    const result = await createCatalogAttributeDefinition(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog attribute creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
