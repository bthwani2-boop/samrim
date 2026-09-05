import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, provisionOperator, readOperatorSession } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "platform_owner") return NextResponse.json({ error: { code: "FORBIDDEN", message: "platform owner access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const body = (await request.json().catch(() => null)) as { phone?: unknown; password?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!phone || password.length < 12 || password.length > 128) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and a password between 12 and 128 characters are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await provisionOperator(phone, password);
    return NextResponse.json(result, { status: result.actorCreated || result.roleCreated ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
