import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRole, readOperatorSession, setIdentityRoleEnabled } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

async function authorizedOperator(permission: "read" | "manage") {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "يلزم تسجيل الدخول.", 401) };
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "الصفحة للمشغلين فقط.", 403) };
  const allowed = permission === "read"
    ? ["marketing", "operations", "finance"].some((key) => identity.permissions?.includes(key as "marketing" | "operations" | "finance"))
    : Boolean(identity.permissions?.includes("operations"));
  if (!allowed) return { error: operatorWorkspacePermissionDenied(identity, permission === "manage" ? "operations" : "marketing")! };
  return { identity };
}
type Context = { params: Promise<{ actorId: string }> };

export async function GET(_request: Request, context: Context) {
  const access = await authorizedOperator("read");
  if (access.error) return access.error;
  const { actorId } = await context.params;
  if (!actorId.trim() || actorId.length > 128) return errorResponse("INVALID_INPUT", "معرف العميل غير صالح.", 400);
  try {
    const customer = await readManagedIdentityRole(actorId, "client");
    return NextResponse.json({ customer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}

export async function POST(request: Request, context: Context) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب من مصدر غير مسموح.", 403);
  const access = await authorizedOperator("manage");
  if (access.error) return access.error;
  const { actorId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const expectedVersion = body?.expectedVersion;
  const enabled = body?.enabled;
  if (!actorId.trim() || actorId.length > 128 || !body || Object.keys(body).some((key) => !["reason", "expectedVersion", "enabled"].includes(key))
    || typeof enabled !== "boolean" || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1
    || Array.from(reason).length < 5 || Array.from(reason).length > 500) {
    return errorResponse("INVALID_INPUT", "الحالة ونسخة الحساب والسبب (5–500 حرف) مطلوبة.", 400);
  }
  try {
    await setIdentityRoleEnabled(actorId, "client", enabled as boolean, reason, {
      expectedVersion: expectedVersion as number,
      operatorActorId: access.identity!.subject,
      correlationId: randomUUID(),
    });
    const customer = await readManagedIdentityRole(actorId, "client");
    if (customer.enabled !== enabled) return errorResponse("READBACK_MISMATCH", "لم تتطابق حالة الحساب المحفوظة مع الإجراء.", 409);
    return NextResponse.json({ customer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
