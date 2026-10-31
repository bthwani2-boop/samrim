import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorStoreContentPerformanceSummary } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return fail("FORBIDDEN", "Cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return fail("UNAUTHENTICATED", "Authentication required", 401);
  if (identity.role !== "operator") return fail("FORBIDDEN", "Operator access required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (denied) return denied;
  const { storeId } = await context.params;
  if (!storeId.trim() || storeId.length > 150) return fail("INVALID_INPUT", "Invalid Store identifier", 400);
  try {
    return NextResponse.json(
      await readOperatorStoreContentPerformanceSummary(storeId, { operatorActorId: identity.subject }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    if (!isDshClientError(cause)) return fail("INTERNAL_ERROR", "Store marketing analytics could not be read", 500);
    const payload = dshErrorPayload(cause);
    return fail(payload.code, payload.message, dshHttpStatus(cause));
  }
}
