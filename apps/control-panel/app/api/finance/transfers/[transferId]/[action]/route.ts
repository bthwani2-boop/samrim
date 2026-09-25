import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, transitionOperatorManualTransfer } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request, context: { params: Promise<{ transferId: string; action: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { transferId, action } = await context.params;
  const body = await request.json().catch(() => null) as { statementRowId?: unknown } | null;
  if ((action !== "verify" && action !== "reconcile") || (action === "reconcile" && (!body || typeof body.statementRowId !== "string" || !body.statementRowId.trim()))) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات المطابقة غير صالحة" } }, { status: 400 });
  try {
    const result = await transitionOperatorManualTransfer(transferId, action, typeof body?.statementRowId === "string" ? body.statementRowId : "", { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تنفيذ المطابقة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
