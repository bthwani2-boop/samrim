import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { OperatorPermission } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, setOperatorPermission } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissions } from "../../../../src/session/operator-permissions";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const permissions = new Set<OperatorPermission>(operatorWorkspacePermissions.map(({ key }) => key));

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.canManageOperatorPermissions) return errorResponse("FORBIDDEN", "operator permission administration is restricted to the initial Operator", 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allowed = ["actorId", "permission", "enabled", "expectedVersion", "reason"];
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const permissionValue = typeof body?.permission === "string" ? body.permission : "";
  const enabled = body?.enabled;
  const expectedVersion = body?.expectedVersion;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const reasonLength = Array.from(reason).length;
  if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || !actorId || actorId.length > 128 || !permissions.has(permissionValue as OperatorPermission) || typeof enabled !== "boolean" || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || reasonLength < 5 || reasonLength > 500) {
    return errorResponse("INVALID_INPUT", "actor, permission, current version and reason are required", 400);
  }

  try {
    const permission = permissionValue as OperatorPermission;
    const access = await setOperatorPermission(actorId, permission, enabled, reason, {
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
