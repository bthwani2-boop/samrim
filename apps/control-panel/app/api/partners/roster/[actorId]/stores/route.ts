import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorPartnerStores } from "../../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ actorId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const cursor = params.get("cursor") ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 128) return errorResponse("INVALID_INPUT", "valid store page limit and cursor are required", 400);
  const { actorId } = await context.params;
  try {
    const page = await listOperatorPartnerStores(actorId, limit, cursor, { operatorActorId: identity.subject });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
