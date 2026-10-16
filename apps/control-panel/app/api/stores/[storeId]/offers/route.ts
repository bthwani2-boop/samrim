import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStoreOffers } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return fail("FORBIDDEN", "Cross-site requests are forbidden.", 403);
  const identity = await readOperatorSession();
  if (!identity) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  if (identity.role !== "operator") return fail("FORBIDDEN", "Operator access required.", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const { storeId } = await context.params;
  const query = new URL(request.url).searchParams;
  const cursor = query.get("cursor") ?? "";
  const limitText = query.get("limit") ?? "8";
  const limit = Number(limitText);
  if (!storeId || storeId.length > 128 || cursor.length > 2048 || !Number.isInteger(limit) || limit < 1 || limit > 30)
    return fail("INVALID_INPUT", "Invalid store offer query.", 400);
  try {
    const data = await listOperatorStoreOffers(storeId, cursor, { operatorActorId: identity.subject }, limit);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return fail("INTERNAL_ERROR", "Store offers could not be read.", 500);
    const payload = dshErrorPayload(error);
    return fail(payload.code, payload.message, dshHttpStatus(error));
  }
}
