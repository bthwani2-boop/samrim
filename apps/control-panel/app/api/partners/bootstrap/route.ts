import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createPartnerBootstrap, dshErrorPayload, dshHttpStatus } from "../../../../lib/dsh-bff";
import { readOperatorSession } from "../../../../lib/identity-bff";
import { verifySameOrigin } from "../../../../lib/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);

  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" && identity.role !== "platform_owner") {
    return errorResponse("FORBIDDEN", "control operator access is required", 403);
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => key !== "partnerActorId" && key !== "storeName") || Object.keys(body).length !== 2) {
    return errorResponse("INVALID_INPUT", "partnerActorId and storeName are required", 400);
  }
  if (typeof body.partnerActorId !== "string" || typeof body.storeName !== "string") {
    return errorResponse("INVALID_INPUT", "partnerActorId and storeName must be strings", 400);
  }
  const partnerActorId = body.partnerActorId.trim();
  const storeName = body.storeName.trim();
  if (!partnerActorId || partnerActorId.length > 128 || storeName.length < 2 || storeName.length > 160) {
    return errorResponse("INVALID_INPUT", "partnerActorId and a storeName of 2 to 160 characters are required", 400);
  }

  try {
    const result = await createPartnerBootstrap(
      { partnerActorId, storeName },
      {
        operatorActorId: identity.subject,
        correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
        idempotencyKey,
      },
    );
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
