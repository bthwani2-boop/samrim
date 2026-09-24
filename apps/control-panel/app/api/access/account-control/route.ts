import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, readOperatorSession, setIdentityRoleEnabled, setIdentitySecurityEnabled } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return jsonError("FORBIDDEN", "operator access is required", 403);
  if (!identity.canManageOperatorPermissions) return jsonError("FORBIDDEN", "operator administration is restricted to the initial Operator", 403);

  const body = (await request.json().catch(() => null)) as { actorId?: unknown; role?: unknown; action?: unknown; reason?: unknown; expectedVersion?: unknown } | null;
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const roleValue = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const rawExpectedVersion = body?.expectedVersion;

  if (!actorId || roleValue !== "operator" || !["disable-role", "enable-role", "disable-identity", "enable-identity"].includes(action) || reason.length < 5 || reason.length > 500) {
    return jsonError("INVALID_INPUT", "operator actorId, action, and a reason of 5 to 500 characters are required", 400);
  }
  if (rawExpectedVersion === undefined || rawExpectedVersion === null) return jsonError("PRECONDITION_REQUIRED", "expectedVersion is required for concurrency safety", 428);
  const expectedVersion = typeof rawExpectedVersion === "number" ? rawExpectedVersion : typeof rawExpectedVersion === "string" && /^[1-9]\d*$/.test(rawExpectedVersion.trim()) ? Number(rawExpectedVersion.trim()) : NaN;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return jsonError("INVALID_INPUT", "expectedVersion must be a positive integer >= 1", 400);

  try {
    const mutationOptions = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion };
    if (action === "disable-role" || action === "enable-role") {
      await setIdentityRoleEnabled(actorId, "operator", action === "enable-role", reason, mutationOptions);
    } else {
      await setIdentitySecurityEnabled(actorId, action === "enable-identity", reason, mutationOptions);
    }
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return jsonError(payload.code, payload.message, identityHttpStatus(error));
  }
}
