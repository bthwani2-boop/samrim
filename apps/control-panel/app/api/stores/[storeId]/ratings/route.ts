import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStoreOrderRatings } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const reject = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return reject("FORBIDDEN", "Cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return reject("UNAUTHENTICATED", "Authentication required", 401);
  if (identity.role !== "operator") return reject("FORBIDDEN", "Operator access required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const { storeId } = await context.params;
  const query = new URL(request.url).searchParams;
  const limit = Number(query.get("limit") ?? "20");
  const cursor = query.get("cursor") ?? "";
  if (!storeId || storeId.length > 128 || !Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 1024)
    return reject("INVALID_INPUT", "Invalid Store rating query", 400);
  try {
    const data = await listOperatorStoreOrderRatings(storeId, cursor, { operatorActorId: identity.subject }, limit);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (!isDshClientError(cause)) return reject("INTERNAL_ERROR", "Store ratings could not be read", 500);
    const payload = dshErrorPayload(cause);
    return reject(payload.code, payload.message, dshHttpStatus(cause));
  }
}
