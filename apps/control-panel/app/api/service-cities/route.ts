import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createServiceCity, dshErrorPayload, dshHttpStatus, isDshClientError, listServiceCities } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function operator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  return { identity } as const;
}

export async function GET(request: Request) {
  const access = await operator();
  if ("error" in access) return access.error;
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  try {
    return NextResponse.json(await listServiceCities(includeInactive, { operatorActorId: access.identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "service city read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await operator();
  if ("error" in access) return access.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["displayNameAr", "active"].includes(key)) || Object.keys(body).length !== 2 || typeof body.displayNameAr !== "string" || typeof body.active !== "boolean") return errorResponse("INVALID_INPUT", "displayNameAr and active are required", 400);
  try {
    const result = await createServiceCity({ displayNameAr: body.displayNameAr.trim(), active: body.active }, { operatorActorId: access.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "service city creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
