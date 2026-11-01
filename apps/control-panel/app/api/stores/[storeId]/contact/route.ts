import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorStorePublicContact } from "../../../../../src/server/dsh/store-contact";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return fail("FORBIDDEN", "Cross-site requests are forbidden.", 403);
  const identity = await readOperatorSession();
  if (!identity) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  if (identity.role !== "operator") return fail("FORBIDDEN", "Operator access required.", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const { storeId } = await context.params;
  if (!storeId?.trim() || storeId.length > 128) return fail("INVALID_INPUT", "Invalid Store ID.", 400);
  try {
    const data = await readOperatorStorePublicContact(storeId, { operatorActorId: identity.subject });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return fail("INTERNAL_ERROR", "Store contact data could not be read.", 500);
    const payload = dshErrorPayload(error);
    return fail(payload.code, payload.message, dshHttpStatus(error));
  }
}
