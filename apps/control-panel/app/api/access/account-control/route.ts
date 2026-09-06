import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { ActorType } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, setIdentityRoleEnabled, setIdentitySecurityEnabled } from "../../../../lib/identity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError, lookupManagedRoleStatus, setManagedRoleEnabled } from "../../../../lib/dsh-bff";
import { verifySameOrigin } from "../../../../lib/csrf";

const roles = new Set<ActorType>(["client", "partner", "captain", "field", "operator"]);
const roleNames = new Set<ActorType>(["partner", "captain", "field"]);

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) {
    return jsonError("FORBIDDEN", "cross-site requests are forbidden", 403);
  }

  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "platform_owner") return jsonError("FORBIDDEN", "platform owner access is required", 403);

  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
    role?: unknown;
    action?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;

  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const roleValue = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const role = roleValue as ActorType;
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const rawExpectedVersion = body?.expectedVersion;

  if (!phone || !roles.has(role) || !["disable-role", "enable-role", "disable-identity", "enable-identity"].includes(action) || reason.length < 5 || reason.length > 500) {
    return jsonError("INVALID_INPUT", "phone, role, action, and a reason of 5 to 500 characters are required", 400);
  }

  if (rawExpectedVersion === undefined || rawExpectedVersion === null) {
    return jsonError("PRECONDITION_REQUIRED", "expectedVersion is required for concurrency safety", 428);
  }
  const expectedVersion = typeof rawExpectedVersion === "number" ? rawExpectedVersion : parseInt(String(rawExpectedVersion), 10);
  if (isNaN(expectedVersion) || expectedVersion < 0) {
    return jsonError("INVALID_INPUT", "expectedVersion must be a non-negative integer", 400);
  }

  try {
    const correlationId = randomUUID();
    const mutationOptions = { operatorActorId: identity.subject, expectedVersion };
    if (action === "disable-role" || action === "enable-role") {
      const enabled = action === "enable-role";
      if (roleNames.has(role)) {
        await setManagedRoleEnabled(phone, role as "partner" | "captain" | "field", enabled, reason, correlationId, mutationOptions);
      } else {
        await setIdentityRoleEnabled(phone, role, enabled, reason, mutationOptions);
      }
    } else {
      let targetActorId: string | undefined;
      if (roleNames.has(role)) {
        const dshStatus = await lookupManagedRoleStatus(phone, role as "partner" | "captain" | "field");
        targetActorId = dshStatus.actorId;
      }
      await setIdentitySecurityEnabled(phone, role, action === "enable-identity", reason, targetActorId, mutationOptions);
    }
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return jsonError(dshErrorPayload(error).code, dshErrorPayload(error).message, dshHttpStatus(error));
    return jsonError(identityErrorPayload(error).code, identityErrorPayload(error).message, identityHttpStatus(error));
  }
}
