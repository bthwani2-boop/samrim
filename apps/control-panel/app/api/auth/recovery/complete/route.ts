import { NextResponse } from "next/server";

import { validatePasswordInputShape, type ControlPanelRole } from "@bthwani/identity";
import { completeControlPanelRecovery, identityErrorPayload, identityHttpStatus } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown; code?: unknown; password?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const role = body?.role === "platform_owner" ? "platform_owner" : body?.role === "operator" ? "operator" : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!phone || !role || !/^\d{6}$/.test(code) || !validatePasswordInputShape(password).valid) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone, role, code, and password are required" } }, { status: 400 });
  try {
    const result = await completeControlPanelRecovery(phone, role as ControlPanelRole, code, password);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error) });
  }
}
