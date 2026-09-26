import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorPartnerFinancialTermsPolicy, dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPartnerFinancialTermsPolicy } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function requireFinancePolicyOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  if (!identity.permissions?.includes("platform_policies") || !identity.permissions.includes("finance")) {
    return { error: errorResponse("FORBIDDEN", "Platform Policies and Finance permissions are required", 403) } as const;
  }
  return { identity } as const;
}

export async function GET() {
  const access = await requireFinancePolicyOperator();
  if ("error" in access) return access.error;
  try {
    const result = await readOperatorPartnerFinancialTermsPolicy({ operatorActorId: access.identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "partner financial terms policy read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await requireFinancePolicyOperator();
  if ("error" in access) return access.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["commissionRateBps", "settlementPeriod", "expectedVersion", "reason"];
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) ||
    !Number.isInteger(body.commissionRateBps) || Number(body.commissionRateBps) < 0 || Number(body.commissionRateBps) > 10000 ||
    (body.settlementPeriod !== "DAILY" && body.settlementPeriod !== "WEEKLY" && body.settlementPeriod !== "MONTHLY") ||
    !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 ||
    typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) {
    return errorResponse("INVALID_INPUT", "partner financial terms fields are invalid", 400);
  }
  try {
    const result = await createOperatorPartnerFinancialTermsPolicy({
      commissionRateBps: Number(body.commissionRateBps),
      settlementPeriod: body.settlementPeriod,
      expectedVersion: Number(body.expectedVersion),
      reason: body.reason.trim(),
    }, {
      operatorActorId: access.identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "partner financial terms policy activation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
