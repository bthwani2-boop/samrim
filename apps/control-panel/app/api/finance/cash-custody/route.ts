import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorCashCustody } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);

  try {
    const result = await listOperatorCashCustody({ operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "cash custody read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
