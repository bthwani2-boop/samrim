import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorOperations } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "50";
  const cursor = params.get("cursor") ?? "";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse("INVALID_INPUT", "limit must be between 1 and 100", 400);
  if (cursor.trim().length > 512) return errorResponse("INVALID_INPUT", "cursor is too long", 400);
  try {
    const result = await listOperatorOperations(params.get("state") ?? "", limit, cursor, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "operator operations read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
