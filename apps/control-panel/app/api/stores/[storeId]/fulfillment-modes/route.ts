import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { verifySameOrigin } from "../../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, setStoreFulfillmentModes } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

const modes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] as const;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => key !== "fulfillmentModes" && key !== "expectedVersion") || Object.keys(body).length !== 2) return errorResponse("INVALID_INPUT", "fulfillmentModes and expectedVersion are required", 400);
  if (!Array.isArray(body.fulfillmentModes) || body.fulfillmentModes.length < 1 || body.fulfillmentModes.some((mode) => typeof mode !== "string" || !modes.includes(mode as (typeof modes)[number])) || new Set(body.fulfillmentModes).size !== body.fulfillmentModes.length || typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) {
    return errorResponse("INVALID_INPUT", "one or more fulfillment modes or expectedVersion are invalid", 400);
  }

  const { storeId } = await context.params;
  try {
    const result = await setStoreFulfillmentModes(storeId, { fulfillmentModes: body.fulfillmentModes as (typeof modes)[number][] }, {
      operatorActorId: identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store fulfillment mode update failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
