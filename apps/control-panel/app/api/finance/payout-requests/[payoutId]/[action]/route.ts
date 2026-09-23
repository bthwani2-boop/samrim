import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { approveOperatorPayout, cancelOperatorPayout, dshErrorPayload, dshHttpStatus, isDshClientError, prepareOperatorPayout } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request, context: { params: Promise<{ payoutId: string; action: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { payoutId, action } = await context.params;
  const body = await request.json().catch(() => null) as { reason?: unknown; evidenceReference?: unknown } | null;
  if (!payoutId?.trim() || !body || typeof body.reason !== "string" || !body.reason.trim() || (action === "prepare" && (typeof body.evidenceReference !== "string" || !body.evidenceReference.trim())) || !["prepare", "approve", "cancel"].includes(action)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "action and reason are required" } }, { status: 400 });
  const contextValue = { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() };
  try {
    if (action === "prepare") return NextResponse.json(await prepareOperatorPayout(payoutId, { reason: body.reason, evidenceReference: body.evidenceReference as string }, contextValue));
    if (action === "approve") return NextResponse.json(await approveOperatorPayout(payoutId, body.reason, contextValue));
    return NextResponse.json(await cancelOperatorPayout(payoutId, body.reason, contextValue));
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "payout action failed" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
