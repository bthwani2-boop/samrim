import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createHREmployee, dshErrorPayload, dshHttpStatus, type HREmployeeInput, isDshClientError, listHREmployees } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function denied(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
async function permittedOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: denied(401, "UNAUTHENTICATED", "authentication required") } as const;
  if (identity.role !== "operator" || !identity.permissions?.includes("hr"))
    return { error: denied(403, "FORBIDDEN", "HR access is required") } as const;
  return { identity } as const;
}
function fail(error: unknown) {
  if (!isDshClientError(error)) return denied(502, "HR_UNAVAILABLE", "employee records are unavailable");
  const payload = dshErrorPayload(error);
  return denied(dshHttpStatus(error), payload.code, payload.message);
}
export async function GET(request: Request) {
  const access = await permittedOperator();
  if ("error" in access) return access.error;
  const search = new URL(request.url).searchParams;
  const q = search.get("q")?.trim() ?? "";
  const cursor = search.get("cursor") ?? "";
  const requestedLimit = search.get("limit") ?? "25";
  const limit = Number(requestedLimit);
  if (q.length > 80 || cursor.length > 1024 || !/^[1-9][0-9]?$/.test(requestedLimit) || !Number.isSafeInteger(limit) || limit > 50)
    return denied(400, "INVALID_INPUT", "invalid HR directory query");
  try {
    const result = await listHREmployees(q, cursor, { operatorActorId: access.identity.subject }, limit);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return denied(403, "FORBIDDEN", "cross-site mutation is forbidden");
  const access = await permittedOperator();
  if ("error" in access) return access.error;
  const body = await request.json().catch(() => null) as Partial<HREmployeeInput> | null;
  if (!body || Object.keys(body).some((key) => !["fullNameAr", "phoneE164", "department", "jobTitle", "managerEmployeeId", "startDate", "workLocation"].includes(key)) ||
    typeof body.fullNameAr !== "string" || typeof body.phoneE164 !== "string" ||
    typeof body.department !== "string" || typeof body.jobTitle !== "string" ||
    typeof body.managerEmployeeId !== "string" || typeof body.startDate !== "string" || typeof body.workLocation !== "string")
    return denied(400, "INVALID_INPUT", "invalid employee information");
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (key.length < 8 || key.length > 128) return denied(400, "INVALID_INPUT", "idempotency key required");
  try {
    const result = await createHREmployee(body as HREmployeeInput, {
      operatorActorId: access.identity.subject,
      correlationId: randomUUID(),
      idempotencyKey: key,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
