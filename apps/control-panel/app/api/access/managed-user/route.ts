import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, issueOperatorEnrollmentToken, provisionOperator, readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!body || Object.keys(body).some((key) => !["phone", "role", "reenroll"].includes(key)) || body.role !== "operator" || body.reenroll === true || !phone || (body.reenroll !== undefined && body.reenroll !== false)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "operator invitation requires a phone; domain roles are managed in their domain workspaces" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const context = { operatorActorId: identity.subject, correlationId: randomUUID() };
    await provisionOperator(phone, context);
    return NextResponse.json(await issueOperatorEnrollmentToken(phone, context), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return NextResponse.json({ error: payload }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
