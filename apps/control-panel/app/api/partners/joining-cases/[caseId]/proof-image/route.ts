import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, downloadJoiningCaseProofImage, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorizedOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  return denied ? { error: denied } as const : { identity } as const;
}

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const authorization = await authorizedOperator();
  if ("error" in authorization) return authorization.error;
  try {
    const { caseId } = await context.params;
    const image = await downloadJoiningCaseProofImage(caseId, { operatorActorId: authorization.identity.subject });
    return new Response(Buffer.from(image.content), { status: 200, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Type": image.contentType, "Content-Disposition": "attachment; filename=joining-case-proof" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "تعذر قراءة صورة الإثبات الخاصة.", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
