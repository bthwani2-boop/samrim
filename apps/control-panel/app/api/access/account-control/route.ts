import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { ActorType } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, setIdentityRoleEnabled, setIdentitySecurityEnabled } from "../../../../lib/identity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError, setManagedRoleEnabled } from "../../../../lib/dsh-bff";

const roles = new Set<ActorType>(["client", "partner", "captain", "field", "operator"]);
const roleNames = new Set<ActorType>(["partner", "captain", "field"]);

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "platform_owner") return jsonError("FORBIDDEN", "platform owner access is required", 403);

  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown; action?: unknown; reason?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const roleValue = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const role = roleValue as ActorType;
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!phone || !roles.has(role) || !["disable-role", "enable-role", "disable-identity", "enable-identity"].includes(action) || reason.length < 5 || reason.length > 500) {
    return jsonError("INVALID_INPUT", "phone, role, action, and a reason of 5 to 500 characters are required", 400);
  }

  try {
    const correlationId = randomUUID();
    if (action === "disable-role" || action === "enable-role") {
      const enabled = action === "enable-role";
      if (roleNames.has(role)) await setManagedRoleEnabled(phone, role as "partner" | "captain" | "field", enabled, reason, correlationId);
      else await setIdentityRoleEnabled(phone, role, enabled, reason);
    } else {
      await setIdentitySecurityEnabled(phone, role, action === "enable-identity", reason);
    }
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return jsonError(dshErrorPayload(error).code, dshErrorPayload(error).message, dshHttpStatus(error));
    return jsonError(identityErrorPayload(error).code, identityErrorPayload(error).message, identityHttpStatus(error));
  }
}
