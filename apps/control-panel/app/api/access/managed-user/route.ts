import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import type { ManagedActivationRole } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, issueOperatorEnrollmentToken, provisionOperator, readOperatorSession } from "../../../../lib/identity-bff";
import { authorizeManagedReenrollment, dshErrorPayload, dshHttpStatus, isDshClientError, lookupManagedRoleStatus, provisionManagedRole } from "../../../../lib/dsh-bff";
import { verifySameOrigin } from "../../../../lib/csrf";

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field", "operator"]);

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown; reenroll?: unknown; recover?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  if (body?.recover !== undefined || (body?.reenroll !== undefined && typeof body.reenroll !== "boolean")) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "recover is retired; use boolean reenroll" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const reenroll = body?.reenroll === true;
  if (!phone || !managedRoles.has(role as ManagedActivationRole)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and managed role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const mutationOptions = { operatorActorId: identity.subject, correlationId: randomUUID() };
    if (reenroll) {
      if (role === "operator") return NextResponse.json({ error: { code: "REENROLLMENT_UNSUPPORTED", message: "operator password recovery is self-service" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const existing = await lookupManagedRoleStatus(phone, role as "partner" | "captain" | "field");
      if (!existing.exists || !existing.activated) return NextResponse.json({ error: { code: "CONFLICT", message: "the managed role is not currently activated" } }, { status: 409, headers: { "Cache-Control": "no-store" } });
      await authorizeManagedReenrollment(phone, role as "partner" | "captain" | "field", mutationOptions);
    }
    if (role === "operator") await provisionOperator(phone, mutationOptions);
    else await provisionManagedRole(phone, role as "partner" | "captain" | "field", mutationOptions);
    if (role === "operator") return NextResponse.json(await issueOperatorEnrollmentToken(phone, mutationOptions), { status: 201, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ status: reenroll ? "role_reenrollment_authorized" : "role_provisioned", role }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
