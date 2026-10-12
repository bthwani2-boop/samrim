import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readHREmployee } from "../../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRole, readOperatorSession, setIdentityRoleEnabled } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

type Context = { params: Promise<{ employeeId: string }> };
const noStore = { "Cache-Control": "no-store" };
const denied = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: noStore });

function failure(error: unknown, origin: "dsh" | "identity") {
  if (origin === "dsh" && isDshClientError(error)) {
    const data = dshErrorPayload(error);
    return denied(dshHttpStatus(error), data.code, data.message);
  }
  const data = identityErrorPayload(error);
  return denied(identityHttpStatus(error), data.code, data.message);
}

async function authorize(employeeId: string) {
  const identity = await readOperatorSession();
  if (!identity) return { error: denied(401, "UNAUTHENTICATED", "sign in required") } as const;
  if (identity.role !== "operator" || !identity.canManageOperatorPermissions)
    return { error: denied(403, "FORBIDDEN", "only the initial operator can change operator access") } as const;
  if (!/^emp_[a-f0-9]{32}$/.test(employeeId))
    return { error: denied(400, "INVALID_INPUT", "invalid employee") } as const;
  try {
    const { employee } = await readHREmployee(employeeId, { operatorActorId: identity.subject });
    if (!employee.operatorActorId)
      return { error: denied(409, "NO_OPERATOR_ACCESS", "this employee has not been granted operator access") } as const;
    return { identity, employee } as const;
  } catch (error) { return { error: failure(error, "dsh") } as const; }
}

export async function GET(_request: Request, context: Context) {
  const result = await authorize((await context.params).employeeId);
  if ("error" in result) return result.error;
  try {
    const actorId = result.employee.operatorActorId;
    if (!actorId) return denied(409, "NO_OPERATOR_ACCESS", "employee has no operator role");
    const role = await readManagedIdentityRole(actorId, "operator");
    return NextResponse.json({ employee: result.employee, role }, { headers: noStore });
  } catch (error) { return failure(error, "identity"); }
}

export async function POST(request: Request, context: Context) {
  if (!verifySameOrigin(request)) return denied(403, "FORBIDDEN", "cross-site requests are forbidden");
  const result = await authorize((await context.params).employeeId);
  if ("error" in result) return result.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const expectedVersion = body?.expectedVersion;
  if (!body || Object.keys(body).some((key) => !["action", "reason", "expectedVersion"].includes(key)) ||
    (action !== "disable" && action !== "enable") ||
    Array.from(reason).length < 8 || Array.from(reason).length > 500 ||
    !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1)
    return denied(400, "INVALID_INPUT", "action, current role version and reason required");
  if (action === "enable" && result.employee.status !== "active")
    return denied(409, "EMPLOYEE_INACTIVE", "operator access cannot be enabled for an inactive employee");
  const actorId = result.employee.operatorActorId;
  if (!actorId) return denied(409, "NO_OPERATOR_ACCESS", "employee has no operator role");
  try {
    // Identity owns operator access. Disabling the role revokes its active
    // sessions and pending invitations, but does not end HR employment.
    await setIdentityRoleEnabled(actorId, "operator", action === "enable",
      "HR employee " + result.employee.id + ": " + reason,
      { operatorActorId: result.identity.subject, correlationId: randomUUID(), expectedVersion: expectedVersion as number });
    const role = await readManagedIdentityRole(actorId, "operator");
    return NextResponse.json({ employee: result.employee, role }, { headers: noStore });
  } catch (error) { return failure(error, "identity"); }
}
