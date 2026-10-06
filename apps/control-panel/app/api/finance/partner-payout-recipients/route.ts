import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPartnerStorePayoutRecipients } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);

  const partnerActorId = new URL(request.url).searchParams.get("partnerActorId")?.trim() ?? "";
  if (!partnerActorId || partnerActorId.length > 128) return errorResponse("INVALID_INPUT", "partnerActorId is required", 400);

  try {
    const result = await readOperatorPartnerStorePayoutRecipients(partnerActorId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "partner payout-recipient read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
