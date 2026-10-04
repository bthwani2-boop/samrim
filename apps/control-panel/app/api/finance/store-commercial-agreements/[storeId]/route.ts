import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorStoreCommercialAgreementsForFinance } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);
  const { storeId } = await context.params;
  if (!storeId?.trim() || storeId.length > 128) return errorResponse("INVALID_INPUT", "storeId is invalid", 400);
  try {
    const result = await readOperatorStoreCommercialAgreementsForFinance(storeId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store commercial agreement readback failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
