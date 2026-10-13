import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listStoreAccessRoleAdmissionsForOperator } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const query = new URL(request.url).searchParams;
  const rawLimit = query.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const cursor = query.get("cursor") ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 512) return errorResponse("INVALID_INPUT", "invalid admission page", 400);
  try {
    const page = await listStoreAccessRoleAdmissionsForOperator({ operatorActorId: identity.subject }, limit, cursor);
    if (!Array.isArray(page.items) || page.items.length > limit || typeof page.nextCursor !== "string") {
      return errorResponse("DSH_VERSION_MISMATCH", "bounded admission pages require the current DSH service version", 502);
    }
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Store access admission queue read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
