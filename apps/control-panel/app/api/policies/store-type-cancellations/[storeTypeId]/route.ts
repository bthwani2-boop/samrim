import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Readonly<{ params: Promise<{ storeTypeId: string }> }>) {
  if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return failure("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return failure("FORBIDDEN", "operator permission required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "platform_policies");
  if (denied) return denied;

  const { storeTypeId } = await context.params;
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const mode = input?.mode;
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  const version = input?.expectedVersion;
  if (!storeTypeId || storeTypeId.length > 128 || !input ||
    Object.keys(input).some(key => !["mode", "reason", "expectedVersion"].includes(key)) ||
    !["OPERATIONS_ONLY", "CLIENT_BEFORE_ACCEPTANCE"].includes(String(mode)) ||
    Array.from(reason).length < 5 || Array.from(reason).length > 500 ||
    !Number.isSafeInteger(version) || Number(version) < 1) {
    return failure("INVALID_INPUT", "mode, reason and expectedVersion are required", 400);
  }
  const key = request.headers.get("Idempotency-Key")?.trim() || randomUUID();
  if (key.length < 8 || key.length > 128) return failure("INVALID_INPUT", "invalid idempotency key", 400);
  try {
    const result = await requestDshJson(
      "PATCH", `/dsh/operator/cancellation-policies/${encodeURIComponent(storeTypeId)}`,
      { mode, reason }, { "X-Acting-Actor-ID": identity.subject, "X-Expected-Version": String(version),
        "Idempotency-Key": key, "X-Correlation-ID": request.headers.get("X-Correlation-ID")?.trim() || randomUUID() });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "policy update unavailable; refresh current record", 500);
    const payload = dshErrorPayload(error);
    return failure(payload.code, payload.message, dshHttpStatus(error));
  }
}
