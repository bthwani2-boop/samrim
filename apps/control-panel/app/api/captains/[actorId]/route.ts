import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readCaptainAdmissionByActor } from "../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRole, readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const operator = await readOperatorSession();
  if (!operator) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (operator.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(operator, "operations");
  if (denied) return denied;

  const { actorId } = await context.params;
  if (!actorId?.trim() || actorId.length > 128) return errorResponse("INVALID_INPUT", "valid captain ID is required", 400);
  try {
    const captain = await readManagedIdentityRole(actorId.trim(), "captain");
    let admission = null;
    try {
      admission = (await readCaptainAdmissionByActor(captain.actorId, { operatorActorId: operator.subject })).admission;
    } catch (error) {
      if (!isDshClientError(error) || dshHttpStatus(error) !== 404) throw error;
    }
    return NextResponse.json({ captain, admission }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
