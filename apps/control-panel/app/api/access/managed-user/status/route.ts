import { NextResponse } from "next/server";

import type { ManagedActivationRole } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, lookupIdentityRole, readOperatorSession } from "../../../../../lib/identity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError, lookupManagedRoleStatus } from "../../../../../lib/dsh-bff";

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field", "operator"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "platform_owner") return NextResponse.json({ error: { code: "FORBIDDEN", message: "platform owner access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const phone = (params.get("phone") ?? "").trim();
  const role = (params.get("role") ?? "").trim().toLowerCase();
  if (!phone || !managedRoles.has(role as ManagedActivationRole)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and managed role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (role !== "operator") {
      const status = await lookupManagedRoleStatus(phone, role as "partner" | "captain" | "field");
      return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
    }
    const record = await lookupIdentityRole(phone, role as ManagedActivationRole);
    return NextResponse.json({
      exists: Boolean(record),
      enabled: record?.enabled ?? false,
      activated: Boolean(record?.activatedAt),
      recoverable: role !== "operator",
      role,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
