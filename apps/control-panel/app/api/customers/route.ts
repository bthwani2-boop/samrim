import { NextResponse } from "next/server";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../src/server/identity/operator-workspace-access";

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "يلزم تسجيل الدخول.", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "الصفحة للمشغلين فقط.", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const cursor = params.get("cursor") ?? "";
  const rawEnabled = params.get("enabled");
  const enabled = rawEnabled === null ? undefined : rawEnabled === "true" ? true : rawEnabled === "false" ? false : null;
  const limit = Number(params.get("limit") ?? "20");
  if (q.length > 100 || cursor.length > 512 || enabled === null || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return errorResponse("INVALID_INPUT", "معايير البحث أو التصفح غير صالحة.", 400);
  }
  try {
    const result = await searchIdentityRoles("client", q, limit, cursor, enabled);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}
