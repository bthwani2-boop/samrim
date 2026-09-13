import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { createJoiningCase, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["contactPhoneE164", "businessName", "firstStoreName"].includes(key)) || Object.keys(body).length !== 3) return errorResponse("INVALID_INPUT", "contactPhoneE164, businessName and firstStoreName are required", 400);
  if (typeof body.contactPhoneE164 !== "string" || typeof body.businessName !== "string" || typeof body.firstStoreName !== "string") return errorResponse("INVALID_INPUT", "joining case facts must be strings", 400);
  try {
    const result = await createJoiningCase(
      { contactPhoneE164: body.contactPhoneE164.trim(), businessName: body.businessName.trim(), firstStoreName: body.firstStoreName.trim() },
      { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey },
    );
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
