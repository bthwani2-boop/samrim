import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, lookupIdentityRoles, readOperatorPermission, readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissions } from "../../../../../src/session/operator-permissions";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!identity.canManageOperatorPermissions) return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator administration is restricted to the initial Operator" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const phone = (params.get("phone") ?? "").trim();
  if (params.get("role") !== "operator" || !phone) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "operator role and phone are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const records = await lookupIdentityRoles(phone);
    const record = records.find((candidate) => candidate.role === "operator");
    const permissionEntries = record && identity.canManageOperatorPermissions && record.actorId !== identity.subject
      ? await Promise.all(operatorWorkspacePermissions.map(async ({ key }) => [key, await readOperatorPermission(record.actorId, key, { operatorActorId: identity.subject, correlationId: randomUUID() })] as const))
      : [];

    return NextResponse.json({
      actorId: record?.actorId,
      phoneE164: record?.phoneE164 ?? phone,
      role: "operator",
      exists: Boolean(record),
      enabled: record?.enabled ?? false,
      activated: Boolean(record?.activatedAt),
      securityEnabled: record?.securityEnabled ?? false,
      state: !record ? "not_admitted" : !record.securityEnabled ? "identity_disabled" : !record.enabled ? "role_disabled" : !record.activatedAt ? "pending_activation" : "active",
      actorVersion: record?.actorVersion,
      roleVersion: record?.roleVersion,
      operatorPermissions: Object.fromEntries(permissionEntries),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return NextResponse.json({ error: payload }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
