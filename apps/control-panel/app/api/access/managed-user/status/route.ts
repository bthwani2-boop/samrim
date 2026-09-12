import { NextResponse } from "next/server";

import type { ActorType } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, lookupIdentityRole, readOperatorSession } from "../../../../../lib/identity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError, lookupManagedRoleStatus } from "../../../../../lib/dsh-bff";

const managedRoles = new Set<ActorType>(["client", "partner", "captain", "field", "operator"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const phone = (params.get("phone") ?? "").trim();
  const role = (params.get("role") ?? "").trim().toLowerCase();
  if (!phone || !managedRoles.has(role as ActorType)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and managed role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    if (role === "partner" || role === "captain" || role === "field") {
      return NextResponse.json(await lookupManagedRoleStatus(phone, role as "partner" | "captain" | "field"), { headers: { "Cache-Control": "no-store" } });
    }
    const record = await lookupIdentityRole(phone, role as ActorType);
    return NextResponse.json({
      actorId: record?.actorId,
      exists: Boolean(record),
      enabled: record?.enabled ?? false,
      activated: Boolean(record?.activatedAt),
      securityEnabled: record?.securityEnabled ?? false,
      reenrollable: Boolean(record?.enabled && record?.activatedAt),
      role,
      actorVersion: record?.actorVersion,
      roleVersion: record?.roleVersion,
      credentialVersion: record?.credentialVersion,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
