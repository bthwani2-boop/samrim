import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readServiceCity, updateServiceCity } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function getOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  return { identity } as const;
}

export async function GET(request: Request, context: { params: Promise<{ cityId: string }> }) {
  const access = await getOperator();
  if ("error" in access) return access.error;
  try {
    const { cityId } = await context.params;
    return NextResponse.json(await readServiceCity(cityId, { operatorActorId: access.identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "service city read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ cityId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await getOperator();
  if ("error" in access) return access.error;
  if (!access.identity.permissions?.includes("platform_policies")) return errorResponse("FORBIDDEN", "Platform Policies permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const expectedVersion = Number(request.headers.get("X-Expected-Version"));
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse("INVALID_INPUT", "X-Expected-Version is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["displayNameAr", "active"].includes(key)) || Object.keys(body).length !== 2 || typeof body.displayNameAr !== "string" || typeof body.active !== "boolean") return errorResponse("INVALID_INPUT", "displayNameAr and active are required", 400);
  try {
    const { cityId } = await context.params;
    const result = await updateServiceCity(cityId, { displayNameAr: body.displayNameAr.trim(), active: body.active }, { operatorActorId: access.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "service city update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
