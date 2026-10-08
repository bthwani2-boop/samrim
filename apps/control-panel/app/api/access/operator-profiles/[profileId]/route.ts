import { randomUUID } from "node:crypto";
import { normalizeYemenPhoneE164 } from "@bthwani/design-system";
import { NextResponse } from "next/server";

import { approveOperatorProfile, grantOperatorProfile, identityErrorPayload, identityHttpStatus, issueOperatorProfileInvitation, readOperatorSession, updateOperatorProfile } from "../../../../../src/server/identity/identity-bff";
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
  try {
    if (action === "update-profile") {
      const fullNameAr = typeof body?.fullNameAr === "string" ? body.fullNameAr.trim() : "";
      const phoneE164 = typeof body?.phoneE164 === "string" ? normalizeYemenPhoneE164(body.phoneE164) : "";
      const jobTitle = typeof body?.jobTitle === "string" ? body.jobTitle.trim() : "";
      const department = typeof body?.department === "string" ? body.department.trim() : "";
      const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : NaN;
      if (Object.keys(body ?? {}).some((key) => !["action", "fullNameAr", "phoneE164", "jobTitle", "department", "expectedVersion"].includes(key)) || Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120 || Array.from(jobTitle).length < 1 || Array.from(jobTitle).length > 80 || Array.from(department).length < 1 || Array.from(department).length > 80 || !/^\+[1-9][0-9]{7,14}$/.test(phoneE164) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return denied(400, "INVALID_INPUT", "a valid profile, phone, job title, department and current profile version are required");
      const result = await updateOperatorProfile(profileId, { fullNameAr, phoneE164, jobTitle, department, expectedVersion }, contextValues);
      return NextResponse.json(result, { headers: noStore });
    }
    if (action === "approve" || action === "grant") {
      const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : NaN;
      if (Object.keys(body ?? {}).some((key) => !["action", "expectedVersion"].includes(key)) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return denied(400, "INVALID_INPUT", "the current profile version is required");
      if (action === "approve") {
        const result = await approveOperatorProfile(profileId, { expectedVersion }, contextValues);
        return NextResponse.json(result, { headers: noStore });
      }
      const result = await grantOperatorProfile(profileId, { expectedVersion }, contextValues);
      return NextResponse.json(result, { status: result.role.actorCreated || result.role.roleCreated ? 201 : 200, headers: noStore });
    }
    if (action === "invitation" && Object.keys(body ?? {}).every((key) => key === "action")) {
      const result = await issueOperatorProfileInvitation(profileId, { operatorActorId: identity.subject, correlationId: randomUUID() });
      return NextResponse.json(result, { status: 201, headers: noStore });
    }
    return denied(400, "INVALID_INPUT", "a supported operator profile action is required");
  } catch (error) {
    const payload = identityErrorPayload(error);
    return denied(identityHttpStatus(error), payload.code, payload.message);
  }
}
