import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorFieldCommissionPolicy, dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorFieldCommissionPolicyByScope } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function requireOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  return { identity } as const;
}

export async function GET(request: Request) {
  const access = await requireOperator();
  if ("error" in access) return access.error;
  const params = new URL(request.url).searchParams;
  const scopeType = params.get("scopeType");
  const scopeId = params.get("scopeId") ?? "";
  if (scopeType !== "DEFAULT" && scopeType !== "VERTICAL" && scopeType !== "STORE") return errorResponse("INVALID_INPUT", "a valid field reward scope is required", 400);
  try {
    const result = await readOperatorFieldCommissionPolicyByScope({ scopeType, scopeId }, { operatorActorId: access.identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "field reward policy read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await requireOperator();
  if ("error" in access) return access.error;
  if (!access.identity.permissions?.includes("platform_policies")) return errorResponse("FORBIDDEN", "Platform Policies permission is required", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["scopeType", "scopeId", "rewardMinor", "roundingUnitMinor", "expectedVersion", "reason"];
  const scopeType = typeof body?.scopeType === "string" ? body.scopeType.trim() : "";
  const scopeId = typeof body?.scopeId === "string" ? body.scopeId.trim() : "";
  const validScopeType = scopeType === "DEFAULT" || scopeType === "VERTICAL" || scopeType === "STORE";
  const validScope = scopeType === "DEFAULT" ? scopeId === "" : scopeId.length > 0 && scopeId.length <= 128;
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || !validScopeType || !validScope || !Number.isInteger(body.rewardMinor) || Number(body.rewardMinor) < 50 || body.roundingUnitMinor !== 50 || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) return errorResponse("INVALID_INPUT", "field commission policy fields are invalid", 400);
  try {
    const result = await createOperatorFieldCommissionPolicy({ scopeType, scopeId, rewardMinor: Number(body.rewardMinor), roundingUnitMinor: 50, expectedVersion: Number(body.expectedVersion), reason: (body.reason as string).trim() }, { operatorActorId: access.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "field commission policy activation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
