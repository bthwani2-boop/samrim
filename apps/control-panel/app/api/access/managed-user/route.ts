import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import type { ManagedActivationRole } from "@bthwani/identity";
import {
  identityErrorPayload,
  identityHttpStatus,
  issueManagedActivationCode,
  provisionOperator,
  readOperatorSession,
} from "../../../../lib/identity-bff";
import { authorizeManagedReenrollment, dshErrorPayload, dshHttpStatus, isDshClientError, lookupManagedRoleStatus, provisionManagedRole } from "../../../../lib/dsh-bff";

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field", "operator"]);

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "platform_owner") return NextResponse.json({ error: { code: "FORBIDDEN", message: "platform owner access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown; recover?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const recover = body?.recover === true;
  if (!phone || !managedRoles.has(role as ManagedActivationRole)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and managed role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    if (recover) {
      if (role === "operator") return NextResponse.json({ error: { code: "RECOVERY_UNSUPPORTED", message: "operator recovery is not available from managed access" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const existing = await lookupManagedRoleStatus(phone, role as "partner" | "captain" | "field");
      if (!existing.exists || !existing.activated) return NextResponse.json({ error: { code: "CONFLICT", message: "the managed role is not currently activated" } }, { status: 409, headers: { "Cache-Control": "no-store" } });
      await authorizeManagedReenrollment(phone, role as "partner" | "captain" | "field", randomUUID());
    }
    if (role === "operator") {
      await provisionOperator(phone);
    } else {
      await provisionManagedRole(phone, role as "partner" | "captain" | "field");
    }
    const result = await issueManagedActivationCode(phone, role as ManagedActivationRole);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
