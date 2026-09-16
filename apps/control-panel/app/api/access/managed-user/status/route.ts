import { NextResponse } from "next/server";

import type { ActorType } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, lookupIdentityRoles, readOperatorSession } from "../../../../../src/server/identity/identity-bff";

const roles = new Set<ActorType>(["client", "partner", "captain", "field", "operator"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const phone = (params.get("phone") ?? "").trim();
  const role = (params.get("role") ?? "").trim().toLowerCase();
  if (!phone || !roles.has(role as ActorType)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const records = await lookupIdentityRoles(phone);
    const record = records.find((candidate) => candidate.role === role);
    const toStatus = (candidate: typeof record) => candidate ? {
      actorId: candidate.actorId,
      phoneE164: candidate.phoneE164,
      role: candidate.role,
      exists: true,
      enabled: candidate.enabled,
      activated: Boolean(candidate.activatedAt),
      securityEnabled: candidate.securityEnabled,
      reenrollable: Boolean(candidate.enabled && candidate.activatedAt && (candidate.role === "partner" || candidate.role === "captain")),
      state: !candidate.securityEnabled ? "identity_disabled" : !candidate.enabled ? "role_disabled" : !candidate.activatedAt ? "pending_activation" : "active",
      actorVersion: candidate.actorVersion,
      roleVersion: candidate.roleVersion,
      credentialVersion: candidate.credentialVersion,
    } : null;
    return NextResponse.json({
      actorId: record?.actorId ?? records[0]?.actorId,
      phoneE164: record?.phoneE164 ?? records[0]?.phoneE164 ?? phone,
      exists: Boolean(record),
      enabled: record?.enabled ?? false,
      activated: Boolean(record?.activatedAt),
      securityEnabled: record?.securityEnabled ?? false,
      reenrollable: Boolean(record?.enabled && record?.activatedAt && (record.role === "partner" || record.role === "captain")),
      state: toStatus(record)?.state ?? "not_admitted",
      role,
      actorVersion: record?.actorVersion,
      roleVersion: record?.roleVersion,
      credentialVersion: record?.credentialVersion,
      admittedRoles: records.map(toStatus),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
