import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return failure("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return failure("FORBIDDEN", "operator access required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const limit = params.get("limit") ?? "10";
  const cursor = params.get("cursor") ?? "";
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 || cursor.length > 512) {
    return failure("INVALID_INPUT", "invalid contact queue paging arguments", 400);
  }
  const query = new URLSearchParams({ limit });
  if (cursor) query.set("cursor", cursor);
  try {
    const { payload } = await requestDshJson("GET",
      `/dsh/operator/customer-contact-queue?${query.toString()}`, undefined,
      { "X-Acting-Actor-ID": identity.subject });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "customer contact queue is unavailable", 500);
    const detail = dshErrorPayload(error);
    return failure(detail.code, detail.message, dshHttpStatus(error));
  }
}
