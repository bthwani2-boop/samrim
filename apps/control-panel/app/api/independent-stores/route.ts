import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStores } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** The independent registry is an operator view over the canonical DSH Store. */
export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const state = params.get("state") ?? "";
  const query = params.get("q")?.trim() ?? "";
  const cursor = params.get("cursor") ?? "";
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || (state !== "" && state !== "unpublished" && state !== "hidden")
    || Array.from(query).length > 128 || query.includes("\0") || cursor.length > 1024
    || params.has("relationModel") || params.has("serviceCityId") || params.has("searchMode")) {
    return errorResponse("INVALID_INPUT", "invalid independent Store registry filters", 400);
  }
  try {
    const page = await listOperatorStores(state, query, "", "contains", "updated_desc", limit, cursor, { operatorActorId: identity.subject }, "INDEPENDENT_STORE");
    // A mismatch indicates a broken DSH boundary: never silently display a market Store.
    if (page.stores.some((store) => store.relationModel !== "INDEPENDENT_STORE")) {
      return errorResponse("DEPENDENCY_UNAVAILABLE", "Store relationship readback is inconsistent", 502);
    }
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    return errorResponse("DEPENDENCY_UNAVAILABLE", "independent Store registry is unavailable", 502);
  }
}
