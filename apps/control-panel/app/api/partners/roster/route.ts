import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readJoiningCaseForPartnerActor, setDshPartnerRoleEnabled } from "../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? "";
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const rawEnabled = params.get("enabled");
  const enabled = rawEnabled === null ? undefined : rawEnabled === "true" ? true : rawEnabled === "false" ? false : null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || enabled === null || query.trim().length > 100 || cursor.length > 512) return errorResponse("INVALID_INPUT", "valid search, cursor, limit, and enabled filters are required", 400);
  try {
    const page = await searchIdentityRoles("partner", query, limit, cursor, enabled);
    const items = await Promise.all(page.items.map(async (role) => {
      try {
        const joiningCase = await readJoiningCaseForPartnerActor(role.actorId, { operatorActorId: identity.subject });
        return { ...role, joiningCase: joiningCase.case };
      } catch (error) {
        if (isDshClientError(error) && dshHttpStatus(error) === 404) return { ...role, joiningCase: null };
        throw error;
      }
    }));
    return NextResponse.json({ items, limit: page.limit, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const rawVersion = body?.expectedVersion;
  const expectedVersion = typeof rawVersion === "number" ? rawVersion : typeof rawVersion === "string" && /^[1-9]\d*$/.test(rawVersion.trim()) ? Number(rawVersion.trim()) : NaN;
  if (!body || Object.keys(body).some((key) => !["action", "actorId", "reason", "expectedVersion"].includes(key)) || !["activate", "disable"].includes(action) || !actorId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Array.from(reason).length < 5 || Array.from(reason).length > 500) return errorResponse("INVALID_INPUT", "actorId, action, current role version, and a reason of 5 to 500 characters are required", 400);
  try {
    await setDshPartnerRoleEnabled(actorId, { enabled: action === "activate", reason }, { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion });
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
