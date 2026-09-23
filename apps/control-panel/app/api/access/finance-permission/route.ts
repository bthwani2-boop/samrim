import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, readOperatorSession, setOperatorFinanceAccess } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.canManageFinanceAccess) return errorResponse("FORBIDDEN", "Finance access administration is restricted to the initial Operator", 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["actorId", "enabled", "expectedVersion", "reason"];
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const enabled = body?.enabled;
  const expectedVersion = body?.expectedVersion;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const reasonLength = Array.from(reason).length;
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || !actorId || actorId.length > 128 || typeof enabled !== "boolean" || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || reasonLength < 5 || reasonLength > 500) {
    return errorResponse("INVALID_INPUT", "actor, permission state, current version and reason are required", 400);
  }

  try {
    const access = await setOperatorFinanceAccess(actorId, enabled, reason, {
      operatorActorId: identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      expectedVersion: expectedVersion as number,
    });
    return NextResponse.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
