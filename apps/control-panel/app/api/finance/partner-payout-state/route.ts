import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPartnerPayoutState } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "control operator access is required" } }, { status: 403 });
  const partnerActorId = new URL(request.url).searchParams.get("partnerActorId")?.trim() ?? "";
  if (!partnerActorId) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "partnerActorId is required" } }, { status: 400 });
  try {
    return NextResponse.json(await readOperatorPartnerPayoutState(partnerActorId, { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "partner payout state read failed" } }, { status: 500 });
    const payload = dshErrorPayload(error);
    return NextResponse.json({ error: payload }, { status: dshHttpStatus(error) });
  }
}
