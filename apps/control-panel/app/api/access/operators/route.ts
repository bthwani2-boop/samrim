import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, readOperatorPermission, readOperatorSession, searchIdentityRoles } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissions } from "../../../../src/session/operator-permissions";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  if (!identity.canManageOperatorPermissions) return errorResponse("FORBIDDEN", "operator administration is restricted to the initial Operator", 403);

  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? "";
  const rawLimit = params.get("limit") ?? "10";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const rawEnabled = params.get("enabled");
  const enabled = rawEnabled === null ? undefined : rawEnabled === "true" ? true : rawEnabled === "false" ? false : null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 || enabled === null || query.trim().length > 100 || cursor.length > 512) {
    return errorResponse("INVALID_INPUT", "valid search, cursor, limit, and enabled filters are required", 400);
  }

  try {
    const page = await searchIdentityRoles("operator", query, limit, cursor, enabled);
    const items = await Promise.all(page.items.map(async (operator) => {
      if (operator.actorId === identity.subject) {
        return { ...operator, permissions: operatorWorkspacePermissions.map(({ key: permission }) => ({ permission, enabled: identity.permissions?.includes(permission) === true })) };
      }
      const permissions = await Promise.all(operatorWorkspacePermissions.map(({ key: permission }) => readOperatorPermission(operator.actorId, permission, { operatorActorId: identity.subject, correlationId: randomUUID() })));
      return { ...operator, permissions };
    }));
    return NextResponse.json({ items, limit: page.limit, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
