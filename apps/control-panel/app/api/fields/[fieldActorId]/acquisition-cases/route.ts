import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorFieldAcquisitionCases } from "../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";

export async function GET(request: Request, context: Readonly<{ params: Promise<{ fieldActorId: string }> }>) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;

  const { fieldActorId } = await context.params;
  const query = new URL(request.url).searchParams;
  const rawLimit = query.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const search = query.get("q") ?? "";
  const cursor = query.get("cursor") ?? "";
  if (!fieldActorId.trim() || fieldActorId.length > 128 || !Number.isInteger(limit) || limit < 1 || limit > 50 || Array.from(search.trim()).length > 100 || cursor.length > 512) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "valid Field actor, search, limit, and cursor are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const page = await listOperatorFieldAcquisitionCases(fieldActorId, search, limit, cursor, { operatorActorId: identity.subject });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
