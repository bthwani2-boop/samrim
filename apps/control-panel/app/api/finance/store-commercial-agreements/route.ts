import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorStoreCommercialAgreementQueue } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "50";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const cursor = params.get("cursor")?.trim() ?? "";
  if (Array.from(params.keys()).some((key) => key !== "limit" && key !== "cursor") || !Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 2048) {
    return errorResponse("INVALID_INPUT", "commercial agreement queue filters are invalid", 400);
  }

  try {
    const result = await readOperatorStoreCommercialAgreementQueue(limit, cursor, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store commercial agreement queue request failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
