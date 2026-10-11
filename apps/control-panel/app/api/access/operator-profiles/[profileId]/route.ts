import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { admitHROperator, dshErrorPayload, dshHttpStatus, type HRAccessRequest, isDshClientError, readHRAccessRequestByProfile } from "../../../../../src/server/dsh/dsh-bff";

import { approveOperatorProfile, grantOperatorProfile, identityErrorPayload, identityHttpStatus, issueOperatorProfileInvitation, readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const noStore = { "Cache-Control": "no-store" };

function denied(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}

export async function POST(request: Request, context: Readonly<{ params: Promise<{ profileId: string }> }>) {
  if (!verifySameOrigin(request)) return denied(403, "FORBIDDEN", "cross-site requests are forbidden");
  const identity = await readOperatorSession();
  if (!identity) return denied(401, "UNAUTHENTICATED", "authentication is required");
  if (identity.role !== "operator" || !identity.canManageOperatorPermissions) return denied(403, "FORBIDDEN", "operator profile administration is restricted to the authorized administrator");
  const { profileId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const contextValues = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };

  const rootActorId = identity.subject;
  async function linkedRequest(): Promise<HRAccessRequest | null> {
    try {
      const result = await readHRAccessRequestByProfile(profileId, {operatorActorId: rootActorId});
      return result.request;
    } catch (error) {
      if (isDshClientError(error) && error.kind === "http" && error.status === 404) return null;
      throw error;
    }
  }
  async function syncEmployee(request: HRAccessRequest) {
    await admitHROperator(request.id, {
      operatorActorId: rootActorId,
      correlationId: randomUUID(),
      idempotencyKey: `hr-admit-${request.id}`,
    });
  }
  try {
    if (action === "approve" || action === "grant") {
      const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : NaN;
      if (Object.keys(body ?? {}).some((key) => !["action", "expectedVersion"].includes(key)) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return denied(400, "INVALID_INPUT", "the current profile version is required");
      const source = await linkedRequest();
      if (source?.state !== "identity_profile_created") {
        return denied(409, "HR_REQUEST_REQUIRED", "Operator admission must originate from an approved HR employee access request");
      }
      if (action === "approve") {
        const result = await approveOperatorProfile(profileId, { expectedVersion }, contextValues);
        return NextResponse.json(result, { headers: noStore });
      }
      const result = await grantOperatorProfile(profileId, { expectedVersion }, contextValues);
      await syncEmployee(source);
      return NextResponse.json(result, { status: result.role.actorCreated || result.role.roleCreated ? 201 : 200, headers: noStore });
    }
    if (action === "invitation" && Object.keys(body ?? {}).every((key) => key === "action")) {
      // Reconcile Identity's successful grant before sending the invitation.
      const source = await linkedRequest();
      if (source) await syncEmployee(source);
      const result = await issueOperatorProfileInvitation(profileId, { operatorActorId: identity.subject, correlationId: randomUUID() });
      return NextResponse.json(result, { status: 201, headers: noStore });
    }
    return denied(400, "INVALID_INPUT", "a supported operator profile action is required");
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return denied(dshHttpStatus(error), payload.code, payload.message);
    }
    const payload = identityErrorPayload(error);
    return denied(identityHttpStatus(error), payload.code, payload.message);
  }
}
