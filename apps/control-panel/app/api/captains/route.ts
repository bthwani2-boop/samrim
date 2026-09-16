import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { admitCaptain, dshErrorPayload, dshHttpStatus, dispatchCaptainOffer, reassignCaptainOffer } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../src/server/security/csrf";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return jsonError("FORBIDDEN", "operator access is required", 403);
  const body = (await request.json().catch(() => null)) as { action?: unknown; phone?: unknown; orderId?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const context = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };
  try {
		if (action === "admit") { const result = await admitCaptain({ contactPhoneE164: phone }, context); return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "dispatch") { const result = await dispatchCaptainOffer(orderId, context); return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "reassign") { const result = await reassignCaptainOffer(orderId, context); return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } }); }
    return jsonError("INVALID_INPUT", "a supported Captain operation is required", 400);
  } catch (error) {
    const payload = dshErrorPayload(error);
    return jsonError(payload.code, payload.message, dshHttpStatus(error));
  }
}
