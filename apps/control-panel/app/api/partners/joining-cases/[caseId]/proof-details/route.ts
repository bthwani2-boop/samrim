import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readJoiningCaseProofDetails } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  try {
    const { caseId } = await context.params;
    const result = await readJoiningCaseProofDetails(caseId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "تعذر قراءة بيانات الإثبات الخاصة.", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
