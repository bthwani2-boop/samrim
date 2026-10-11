import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listArchivedStores } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const cursor = new URL(request.url).searchParams.get("cursor") ?? "";
  if (cursor.length > 512) return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
  try {
    const result = await listArchivedStores(cursor, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
