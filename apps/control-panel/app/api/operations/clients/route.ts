import { NextResponse } from "next/server";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "يلزم تسجيل الدخول." } }, { status: 401 });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "هذه الصفحة لفريق التشغيل." } }, { status: 403 });
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3 || query.length > 30 || !/^[+\d\s-]+$/.test(query)) return NextResponse.json({ clients: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const page = await searchIdentityRoles("client", query.replace(/[\s-]/g, ""), 25, "", true);
    return NextResponse.json({ clients: page.items.map((actor) => ({ id: actor.actorId, phone: actor.phoneE164 })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
