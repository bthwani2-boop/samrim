import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readJoiningCaseForPartnerActor } from "../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRole, readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ actorId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;

  try {
    const { actorId } = await context.params;
    const normalizedActorId = actorId.trim();
    if (!normalizedActorId || normalizedActorId.length > 128) {
      return errorResponse("INVALID_INPUT", "a valid partner actor ID is required", 400);
    }
    const partner = await readManagedIdentityRole(normalizedActorId, "partner");
    let joiningCase = null;
    try {
      joiningCase = (await readJoiningCaseForPartnerActor(partner.actorId, { operatorActorId: identity.subject })).case;
    } catch (error) {
      if (!isDshClientError(error) || dshHttpStatus(error) !== 404) throw error;
    }
    return NextResponse.json({ partner, joiningCase }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
