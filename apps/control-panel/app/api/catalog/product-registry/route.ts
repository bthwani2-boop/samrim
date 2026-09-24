import { NextResponse } from "next/server";
import { listCatalogProductRegistry, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  const params = new URL(request.url).searchParams;
  try {
    const result = await listCatalogProductRegistry({
      query: params.get("q")?.trim() ?? "",
      verticalId: params.get("verticalId")?.trim() ?? "",
      categoryId: params.get("categoryId")?.trim() ?? "",
      active: params.get("active")?.trim() || "all",
      sort: params.get("sort")?.trim() || "name_asc",
      cursor: params.get("cursor")?.trim() ?? "",
    }, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog Product registry lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
