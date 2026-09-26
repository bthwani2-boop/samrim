import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPartnerStoreCommissionPolicies, updateOperatorPartnerStoreCommissionPolicy } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function requireFinanceOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return { error: errorResponse("FORBIDDEN", "Finance permission is required", 403) } as const;
  return { identity } as const;
}

function handleDshError(error: unknown) {
  if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store commission policy request failed", 500);
  const payload = dshErrorPayload(error);
  return errorResponse(payload.code, payload.message, dshHttpStatus(error));
}

export async function GET(request: Request) {
  const access = await requireFinanceOperator();
  if ("error" in access) return access.error;
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || storeId.length > 128) return errorResponse("INVALID_INPUT", "storeId is required", 400);
  try {
    const result = await readOperatorPartnerStoreCommissionPolicies(storeId, { operatorActorId: access.identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleDshError(error);
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await requireFinanceOperator();
  if ("error" in access) return access.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["storeId", "fulfillmentMode", "commissionRateBps", "expectedVersion", "reason"];
  const storeId = typeof body?.storeId === "string" ? body.storeId.trim() : "";
  const fulfillmentMode = typeof body?.fulfillmentMode === "string" ? body.fulfillmentMode.trim() : "";
  const commissionRateBps = body?.commissionRateBps;
  const expectedVersion = body?.expectedVersion;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const reasonLength = Array.from(reason).length;
  const validMode = fulfillmentMode === "BTHWANI_CAPTAIN" || fulfillmentMode === "PARTNER_CAPTAIN" || fulfillmentMode === "CUSTOMER_PICKUP";
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || !storeId || storeId.length > 128 || !validMode || !Number.isInteger(commissionRateBps) || Number(commissionRateBps) < 0 || Number(commissionRateBps) > 10000 || !Number.isInteger(expectedVersion) || Number(expectedVersion) < 1 || reasonLength < 8 || reasonLength > 500) {
    return errorResponse("INVALID_INPUT", "Store commission policy fields are invalid", 400);
  }
  try {
    const result = await updateOperatorPartnerStoreCommissionPolicy({
      storeId,
      fulfillmentMode: fulfillmentMode as "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP",
      commissionRateBps: Number(commissionRateBps),
      expectedVersion: Number(expectedVersion),
      reason,
    }, {
      operatorActorId: access.identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleDshError(error);
  }
}
