import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { verifySameOrigin } from "../../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readStorePublication, setStorePublication } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function operatorIdentity(request: Request) {
  if (!verifySameOrigin(request)) return { response: errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403) } as const;
  const identity = await readOperatorSession();
  if (!identity) return { response: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { response: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  return { identity } as const;
}

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const authorization = await operatorIdentity(request);
  if ("response" in authorization) return authorization.response;
  const { storeId } = await context.params;
  try {
    const result = await readStorePublication(storeId, { operatorActorId: authorization.identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store publication read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const authorization = await operatorIdentity(request);
  if ("response" in authorization) return authorization.response;

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => key !== "state" && key !== "expectedVersion") || Object.keys(body).length !== 2) {
    return errorResponse("INVALID_INPUT", "state and expectedVersion are required", 400);
  }
  if ((body.state !== "published" && body.state !== "hidden") || typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) {
    return errorResponse("INVALID_INPUT", "state and a positive expectedVersion are required", 400);
  }

  const { storeId } = await context.params;
  try {
    const result = await setStorePublication(storeId, body.state, {
      operatorActorId: authorization.identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store publication failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
