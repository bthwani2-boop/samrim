import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { authorizeDshPartnerReenrollment, dshErrorPayload, dshHttpStatus, isDshClientError, setDshPartnerRoleEnabled } from "../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function parseVersion(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) return Number(value.trim());
  return NaN;
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
  let enabled: boolean | null | undefined;
  if (rawEnabled === null) enabled = undefined;
  else if (rawEnabled === "true") enabled = true;
  else if (rawEnabled === "false") enabled = false;
  else enabled = null;
  const rawSort = params.get("sort") ?? "phone_asc";
  const sort = rawSort === "phone_asc" || rawSort === "phone_desc" ? rawSort : null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || enabled === null || sort === null || query.trim().length > 100 || cursor.length > 512) return errorResponse("INVALID_INPUT", "valid search, cursor, sort, limit, and enabled filters are required", 400);
  try {
    const page = await searchIdentityRoles("partner", query, limit, cursor, enabled, sort);
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
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
  const expectedVersion = parseVersion(body?.expectedVersion);
  const expectedActorVersion = parseVersion(body?.expectedActorVersion);
  const expectedRoleVersion = parseVersion(body?.expectedRoleVersion);
  const expectedJoiningCaseVersion = parseVersion(body?.expectedJoiningCaseVersion);
  const allowedKeys = ["action", "actorId", "reason", "expectedVersion", "expectedActorVersion", "expectedRoleVersion", "expectedJoiningCaseVersion"];
  if (!body || Object.keys(body).some((key) => !allowedKeys.includes(key)) || !["activate", "disable", "reenroll"].includes(action) || !actorId || Array.from(reason).length < 5 || Array.from(reason).length > 500) return errorResponse("INVALID_INPUT", "actorId, a supported action, and a reason of 5 to 500 characters are required", 400);
  if (action === "reenroll" && (!Number.isSafeInteger(expectedActorVersion) || expectedActorVersion < 1 || !Number.isSafeInteger(expectedRoleVersion) || expectedRoleVersion < 1 || !Number.isSafeInteger(expectedJoiningCaseVersion) || expectedJoiningCaseVersion < 1)) return errorResponse("INVALID_INPUT", "current joining-case, actor and role versions are required for re-enrollment", 400);
  if (action !== "reenroll" && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) return errorResponse("INVALID_INPUT", "current role version is required for role activation or suspension", 400);
  try {
    if (action === "reenroll") {
      await authorizeDshPartnerReenrollment(actorId, { expectedActorVersion, expectedRoleVersion, reason }, { operatorActorId: identity.subject, correlationId: randomUUID(), expectedDomainVersion: expectedJoiningCaseVersion });
      return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
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
