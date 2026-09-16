import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { admitField, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../src/server/security/csrf";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const body = (await request.json().catch(() => null)) as { contactPhoneE164?: unknown } | null;
  const contactPhoneE164 = typeof body?.contactPhoneE164 === "string" ? body.contactPhoneE164.trim() : "";
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "a valid E.164 phone is required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await admitField({ contactPhoneE164 }, { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
    return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
  }
}
