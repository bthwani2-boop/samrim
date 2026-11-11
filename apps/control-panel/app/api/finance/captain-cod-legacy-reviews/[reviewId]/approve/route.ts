import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-transport";
import { approveOperatorLegacyCODRecovery } from "../../../../../../src/server/dsh/finance-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ reviewId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403 });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { reviewId } = await context.params;
  if (!reviewId.trim() || reviewId.length > 128) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "review ID is invalid" } }, { status: 400 });
  try {
    return NextResponse.json(await approveOperatorLegacyCODRecovery(reviewId, {
      operatorActorId: identity.subject,
      idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID(),
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر اعتماد مراجعة النقد التاريخي" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}