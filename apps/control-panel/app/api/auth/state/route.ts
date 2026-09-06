import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, readControlPanelAuthState } from "../../../../lib/identity-bff";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!phone) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone is required" } }, { status: 400 });
  try {
    return NextResponse.json(await readControlPanelAuthState(phone), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error) });
  }
}
