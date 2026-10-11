import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, mutateCatalogCategoryTrash } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const denied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (denied) return denied;
  const expectedVersion = Number(request.headers.get("X-Expected-Version"));
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || idempotencyKey.length < 8 || idempotencyKey.length > 128) return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || (input.action !== "trash" && input.action !== "restore") || typeof input.reason !== "string" || (input.action === "trash" && (Array.from(input.reason.trim()).length < 5 || Array.from(input.reason.trim()).length > 500)) || (input.action === "restore" && input.reason !== "")) return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
  try {
    const { categoryId } = await context.params;
    const result = await mutateCatalogCategoryTrash(categoryId, input.action, expectedVersion, input.reason.trim(), { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
