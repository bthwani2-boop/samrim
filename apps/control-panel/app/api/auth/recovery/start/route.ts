import { NextResponse } from "next/server";

import type { ControlPanelRole } from "@bthwani/identity";
import { identityErrorPayload, identityHttpStatus, requestControlPanelRecovery } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const role = body?.role === "platform_owner" ? "platform_owner" : body?.role === "operator" ? "operator" : "";
  if (!phone || !role) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and control-panel role are required" } }, { status: 400 });
  try {
    const challenge = await requestControlPanelRecovery(phone, role as ControlPanelRole);
    return NextResponse.json(challenge, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error) });
  }
}
