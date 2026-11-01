import { NextResponse } from "next/server";
import { listOperatorCatalogActivity } from "../../../src/server/dsh/catalog-activity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../src/server/identity/operator-workspace-access";

const noStore = { "Cache-Control": "no-store" };
function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "catalog") ?? operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const q = query.get("q")?.trim() ?? "";
  const kind = query.get("kind")?.trim() ?? "";
  const action = query.get("action")?.trim() ?? "";
  const storeId = query.get("storeId")?.trim() ?? "";
  const from = query.get("from")?.trim() ?? "";
  const to = query.get("to")?.trim() ?? "";
  const limit = query.get("limit")?.trim() || "20";
  const cursor = query.get("cursor")?.trim() ?? "";
  if (q.length > 120 || storeId.length > 128 || cursor.length > 2048 ||
      (kind !== "" && !["product", "offer"].includes(kind)) ||
      (action !== "" && !["created", "updated", "migrated"].includes(action)) ||
      !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit) ||
      (from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
    return errorResponse("INVALID_INPUT", "activity filters are invalid", 400);
  }
  try {
    const result = await listOperatorCatalogActivity({ q, kind, action, storeId, from, to, limit, cursor }, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog activity lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
