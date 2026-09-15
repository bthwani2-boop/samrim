import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { createJoiningCase, dshErrorPayload, dshHttpStatus, isDshClientError, listJoiningCases } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["contactPhoneE164", "businessName", "firstStoreName", "serviceCityId", "firstStoreVerticalId"].includes(key)) || Object.keys(body).length !== 5) return errorResponse("INVALID_INPUT", "contactPhoneE164, businessName, firstStoreName, serviceCityId and firstStoreVerticalId are required", 400);
  if (typeof body.contactPhoneE164 !== "string" || typeof body.businessName !== "string" || typeof body.firstStoreName !== "string" || typeof body.serviceCityId !== "string" || typeof body.firstStoreVerticalId !== "string") return errorResponse("INVALID_INPUT", "joining case facts must be strings", 400);
  const contactPhoneE164 = body.contactPhoneE164.replace(/\s+/g, "");
  if (!phoneE164Pattern.test(contactPhoneE164)) return errorResponse("INVALID_INPUT", "contactPhoneE164 must use strict E.164 format", 400);
  try {
    const result = await createJoiningCase(
      { contactPhoneE164, businessName: body.businessName.trim(), firstStoreName: body.firstStoreName.trim(), serviceCityId: body.serviceCityId.trim(), firstStoreVerticalId: body.firstStoreVerticalId.trim() },
      { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey },
    );
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return errorResponse("INVALID_INPUT", "limit must be between 1 and 50", 400);
  try {
    return NextResponse.json(await listJoiningCases(params.get("state") ?? "", limit, params.get("cursor") ?? "", { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case queue read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
