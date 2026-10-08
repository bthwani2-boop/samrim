import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, readOperatorSession, updateOperatorRoleDetails } from "../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const noStore = { "Cache-Control": "no-store" };

function denied(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return denied(403, "FORBIDDEN", "cross-site requests are forbidden");
  const identity = await readOperatorSession();
  if (!identity) return denied(401, "UNAUTHENTICATED", "authentication is required");
  if (identity.role !== "operator" || !identity.canManageOperatorPermissions) return denied(403, "FORBIDDEN", "operator profile administration is restricted to the authorized administrator");

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const jobTitle = typeof body?.jobTitle === "string" ? body.jobTitle.trim() : "";
  const department = typeof body?.department === "string" ? body.department.trim() : "";
  const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : NaN;
  if (!body || Object.keys(body).some((key) => !["actorId", "jobTitle", "department", "expectedVersion"].includes(key)) || actorId.length < 1 || actorId.length > 128 || Array.from(jobTitle).length < 1 || Array.from(jobTitle).length > 80 || Array.from(department).length < 1 || Array.from(department).length > 80 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return denied(400, "INVALID_INPUT", "a valid operator, title, department and current role version are required");

  try {
    const result = await updateOperatorRoleDetails(actorId, { jobTitle, department, expectedVersion }, { operatorActorId: identity.subject, correlationId: randomUUID() });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return denied(identityHttpStatus(error), payload.code, payload.message);
  }
}
