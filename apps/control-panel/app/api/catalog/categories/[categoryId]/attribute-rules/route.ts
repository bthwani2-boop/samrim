import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogCategoryAttributeRules } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ categoryId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  try {
    const { categoryId } = await context.params;
    return NextResponse.json(await listCatalogCategoryAttributeRules(categoryId, { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "category attribute rules could not be read", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
