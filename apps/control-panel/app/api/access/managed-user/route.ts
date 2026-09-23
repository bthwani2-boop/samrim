import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { authorizeDshFieldReenrollment, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { authorizeIdentityRoleReenrollment, identityErrorPayload, identityHttpStatus, issueOperatorEnrollmentToken, provisionOperator, readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const roles = new Set<string>(["partner", "captain", "field", "operator"]);

type ManagedUserRequest = Readonly<{
  phone?: unknown;
  actorId?: unknown;
  role?: unknown;
  reenroll?: unknown;
  recover?: unknown;
  actorVersion?: unknown;
  roleVersion?: unknown;
  operationalAdmissionVersion?: unknown;
  reason?: unknown;
}>;

async function authorizeManagedRoleReenrollment(
  body: ManagedUserRequest | null,
  role: string,
  actorId: string,
  mutationOptions: Readonly<{ operatorActorId: string; correlationId: string }>,
) {
  const actorVersion = body?.actorVersion;
  const roleVersion = body?.roleVersion;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const reasonLength = Array.from(reason).length;
  if (!Number.isSafeInteger(actorVersion) || (actorVersion as number) < 1 || !Number.isSafeInteger(roleVersion) || (roleVersion as number) < 1 || reasonLength < 5 || reasonLength > 500) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "reenrollment requires current actor and role versions and a reason of 5 to 500 characters" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (role === "field") {
    const expectedAdmissionVersion = body?.operationalAdmissionVersion;
    if (!Number.isSafeInteger(expectedAdmissionVersion) || (expectedAdmissionVersion as number) < 1) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "current Field admission version is required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    await authorizeDshFieldReenrollment(actorId, { expectedActorVersion: actorVersion as number, expectedRoleVersion: roleVersion as number, reason }, { ...mutationOptions, expectedAdmissionVersion: expectedAdmissionVersion as number });
  } else {
    await authorizeIdentityRoleReenrollment(actorId, role as "partner" | "captain", { ...mutationOptions, expectedActorVersion: actorVersion as number, expectedRoleVersion: roleVersion as number, reason });
  }
  return NextResponse.json({ status: "role_reenrollment_authorized", actorId, role }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const body = (await request.json().catch(() => null)) as ManagedUserRequest | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  if (body?.recover !== undefined || (body?.reenroll !== undefined && typeof body.reenroll !== "boolean")) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "recover is retired; use boolean reenroll" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const reenroll = body?.reenroll === true;
  if (!roles.has(role)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "a supported role is required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const mutationOptions = { operatorActorId: identity.subject, correlationId: randomUUID() };
    if (role !== "operator") {
      if (!reenroll || !actorId) return NextResponse.json({ error: { code: "DOMAIN_ADMISSION_REQUIRED", message: "managed role admission is owned by the domain workflow; this screen only addresses an admitted actor for reenrollment" } }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return await authorizeManagedRoleReenrollment(body, role, actorId, mutationOptions);
    }
    if (reenroll || !phone) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "operator invitation requires a phone and does not use generic reenrollment" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    await provisionOperator(phone, mutationOptions);
    return NextResponse.json(await issueOperatorEnrollmentToken(phone, mutationOptions), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : identityErrorPayload(error);
    const status = isDshClientError(error) ? dshHttpStatus(error) : identityHttpStatus(error);
    return NextResponse.json({ error: payload }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
