import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";

const noStore = { "Cache-Control": "no-store" };
function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}
export async function GET(_request: Request, context: Readonly<{ params: Promise<{ orderId: string }> }>) {
  const identity = await readOperatorSession();
  if (!identity) return failure("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return failure("FORBIDDEN", "operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;
  const { orderId } = await context.params;
  if (!orderId?.trim() || orderId.length > 128) return failure("INVALID_INPUT", "orderId invalid", 400);
  try {
    const result = await requestDshJson("GET",
      `/dsh/operator/operations/${encodeURIComponent(orderId)}/mission-location`,
      undefined, { "X-Acting-Actor-ID": identity.subject });
    return NextResponse.json(result.payload, { headers: noStore });
  } catch (error) {
    if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "mission location is unavailable", 500);
    const detail = dshErrorPayload(error);
    return failure(detail.code, detail.message, dshHttpStatus(error));
  }
}
