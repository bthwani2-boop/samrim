import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listMarketingPartnerDecisions } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";

const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return fail("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return fail("FORBIDDEN", "operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (denied) return denied;
  const { promotionId } = await params;
  if (!promotionId || promotionId.length > 128) return fail("INVALID_INPUT", "invalid promotionId", 400);
  const search = new URL(request.url).searchParams;
  const cursor = search.get("cursor") ?? "";
  const decision = search.get("decision") ?? "";
  if (cursor.length > 128 || !["", "PENDING", "OPTED_IN", "DECLINED"].includes(decision))
    return fail("INVALID_INPUT", "invalid participation filter", 400);
  try {
    const data = await listMarketingPartnerDecisions(
      promotionId, cursor, decision as "" | "PENDING" | "OPTED_IN" | "DECLINED",
      { operatorActorId: identity.subject },
    );
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return fail("INTERNAL_ERROR", "partner participation lookup failed", 500);
    const payload = dshErrorPayload(error);
    return fail(payload.code, payload.message, dshHttpStatus(error));
  }
}
