import { NextResponse } from "next/server";

import { completeOperatorRecovery, identityErrorPayload, identityHttpStatus } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown; code?: unknown; password?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!phone || !/^\d{6}$/.test(code) || password.length < 15) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone, code, and password are required" } }, { status: 400 });
  try {
    const result = await completeOperatorRecovery(phone, code, password);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error) });
  }
}
