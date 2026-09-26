import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStores } from "../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const state = params.get("state") ?? "";
  const search = params.get("q")?.trim() ?? "";
  const serviceCityId = params.get("serviceCityId")?.trim() ?? "";
  const sort = params.get("sort") ?? "updated_desc";
  const cursor = params.get("cursor") ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 1024 || Array.from(search).length > 128 || serviceCityId.length > 128 || (state !== "" && state !== "unpublished" && state !== "published" && state !== "hidden") || (sort !== "updated_desc" && sort !== "updated_asc")) {
    return errorResponse("INVALID_INPUT", "store filters, sort, limit, or cursor are invalid", 400);
  }

  try {
		const page = await listOperatorStores(state, search, serviceCityId, "contains", sort, limit, cursor, { operatorActorId: identity.subject });
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
