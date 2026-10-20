import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

// An operator first reviews the Store's preparation/custody status. This route
// cannot mint customer wallet credits or bypass the DSH operations permission.
export async function POST(request: Request, context: Readonly<{ params: Promise<{ orderId: string }> }>) {
  if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return failure("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return failure("FORBIDDEN", "operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;

  const { orderId } = await context.params;
  const input = await request.json().catch(() => null) as { reason?: unknown; partnerReviewed?: unknown; expectedVersion?: unknown } | null;
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  const expectedVersion = input?.expectedVersion;
  if (!orderId || orderId.length > 128 || Array.from(reason).length < 12 || Array.from(reason).length > 500 ||
    !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1 || typeof input?.partnerReviewed !== "boolean") {
    return failure("INVALID_INPUT", "reviewed reason, partner review and current order version are required", 400);
  }
  const key = request.headers.get("Idempotency-Key")?.trim() || randomUUID();
  if (key.length < 8 || key.length > 128) return failure("INVALID_INPUT", "invalid idempotency key", 400);
  try {
    const response = await requestDshJson("POST",
      `/dsh/operator/operations/${encodeURIComponent(orderId)}/cancel`,
      { reason, partnerReviewed: input.partnerReviewed }, {
        "X-Acting-Actor-ID": identity.subject,
        "X-Expected-Version": String(expectedVersion),
        "Idempotency-Key": key,
        "X-Correlation-ID": request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      });
    return NextResponse.json(response.payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "operator cancellation unavailable; read back order state", 500);
    const payload = dshErrorPayload(error);
    return failure(payload.code, payload.message, dshHttpStatus(error));
  }
}
