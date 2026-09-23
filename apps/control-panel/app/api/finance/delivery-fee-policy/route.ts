import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorDeliveryFeePolicy, dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorDeliveryFeePolicy } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function requireOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return { error: errorResponse("FORBIDDEN", "Finance permission is required", 403) } as const;
  return { identity } as const;
}

export async function GET(request: Request) {
  const access = await requireOperator();
  if ("error" in access) return access.error;
  const serviceCityId = new URL(request.url).searchParams.get("serviceCityId") ?? "";
  try {
    const result = await readOperatorDeliveryFeePolicy(serviceCityId, { operatorActorId: access.identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "delivery fee policy read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await requireOperator();
  if ("error" in access) return access.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["serviceCityId", "baseFeeMinor", "distanceUnitMeters", "distanceRateMinor", "orderSizeUnitBaseUnits", "orderSizeRateMinor", "zoneSurchargeMinor", "roundingUnitMinor"];
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || (body.serviceCityId !== undefined && typeof body.serviceCityId !== "string") || !Number.isInteger(body.baseFeeMinor) || Number(body.baseFeeMinor) < 0 || !Number.isInteger(body.distanceUnitMeters) || Number(body.distanceUnitMeters) < 1 || !Number.isInteger(body.distanceRateMinor) || Number(body.distanceRateMinor) < 0 || !Number.isInteger(body.orderSizeUnitBaseUnits) || Number(body.orderSizeUnitBaseUnits) < 1 || !Number.isInteger(body.orderSizeRateMinor) || Number(body.orderSizeRateMinor) < 0 || !Number.isInteger(body.zoneSurchargeMinor) || Number(body.zoneSurchargeMinor) < 0 || body.roundingUnitMinor !== 50) return errorResponse("INVALID_INPUT", "delivery fee policy fields are invalid", 400);
  try {
    const result = await createOperatorDeliveryFeePolicy({ serviceCityId: typeof body.serviceCityId === "string" ? body.serviceCityId.trim() : "", baseFeeMinor: Number(body.baseFeeMinor), distanceUnitMeters: Number(body.distanceUnitMeters), distanceRateMinor: Number(body.distanceRateMinor), orderSizeUnitBaseUnits: Number(body.orderSizeUnitBaseUnits), orderSizeRateMinor: Number(body.orderSizeRateMinor), zoneSurchargeMinor: Number(body.zoneSurchargeMinor), roundingUnitMinor: 50 }, { operatorActorId: access.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "delivery fee policy activation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
