import { dshOperationPaths, type OperatorCustomerOrdersResponse } from "@bthwani/dsh";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRole, readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";

const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: { params: Promise<{ actorId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return fail("UNAUTHENTICATED", "يلزم تسجيل الدخول.", 401);
  if (identity.role !== "operator") return fail("FORBIDDEN", "هذه المساحة للمشغلين.", 403);
  if (!identity.permissions?.includes("marketing") && !identity.permissions?.includes("operations")) {
    return operatorWorkspacePermissionDenied(identity, "marketing")!;
  }
  const { actorId } = await context.params;
  const cursor = new URL(request.url).searchParams.get("cursor") ?? "";
  if (!actorId.trim() || actorId.length > 128 || cursor.length > 512) return fail("INVALID_INPUT", "معرف العميل أو الصفحة غير صالح.", 400);
  try {
    await readManagedIdentityRole(actorId, "client");
    const params = new URLSearchParams({ limit: "15" });
    if (cursor) params.set("cursor", cursor);
    const operation = dshOperationPaths.listOperatorCustomerOrders;
    const path = operation.path.replace("{actorId}", encodeURIComponent(actorId));
    const result = await requestDshJson<OperatorCustomerOrdersResponse>(operation.method, `${path}?${params}`, undefined, { "X-Acting-Actor-ID": identity.subject });
    return NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return fail(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return fail(payload.code, payload.message, identityHttpStatus(error));
  }
}
