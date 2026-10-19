import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readMarketingPromotionSettlementSummary } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "finance");
  if (denied) return denied;
  const { promotionId } = await params;
  if (!promotionId || promotionId.length > 128) return errorResponse("INVALID_INPUT", "invalid promotionId", 400);
  try {
    return NextResponse.json(await readMarketingPromotionSettlementSummary(promotionId, { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "promotion settlement lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
