import { NextRequest, NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorHomeAnalytics } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const periods = request.nextUrl.searchParams.getAll("period");
  if (periods.length > 1 || (periods.length === 1 && periods[0] !== "7d" && periods[0] !== "30d")) {
    return errorResponse("INVALID_INPUT", "period must be 7d or 30d", 400);
  }
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;
  try {
    const result = await readOperatorHomeAnalytics({ operatorActorId: identity.subject }, periods[0] === "30d" ? "30d" : "7d");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "operator home analytics read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
