import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

type Context = Readonly<{ params: Promise<{ orderId: string }> }>;
const headers = { "Cache-Control": "no-store" };
function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
export async function POST(request: Request, context: Context) {
  if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-origin request rejected", 403);
  const identity = await readOperatorSession();
  if (!identity) return failure("UNAUTHENTICATED", "operator session required", 401);
  if (identity.role !== "operator") return failure("FORBIDDEN", "operator required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;
  const { orderId } = await context.params;
  const body = await request.json().catch(() => null) as { release?: unknown; expectedVersion?: unknown } | null;
  if (!orderId?.trim() || orderId.length > 128 || typeof body?.release !== "boolean"
    || !Number.isSafeInteger(body?.expectedVersion) || Number(body?.expectedVersion) < 0) {
    return failure("INVALID_INPUT", "release and expectedVersion required", 400);
  }
  try {
    const result = await requestDshJson("POST", "/dsh/operator/operations/" + encodeURIComponent(orderId) + "/contact-review/claim",
      { release: body.release, expectedVersion: body.expectedVersion }, { "X-Acting-Actor-ID": identity.subject });
    return NextResponse.json(result.payload, { status: result.status, headers });
  } catch (cause) {
    if (!isDshClientError(cause)) return failure("INTERNAL_ERROR", "contact claim result unknown; reload before retry", 500);
    const detail = dshErrorPayload(cause);
    return failure(detail.code, detail.message, dshHttpStatus(cause));
  }
}
