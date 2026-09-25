import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, registerOperatorSettlementStatement } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const body = await request.json().catch(() => null) as { batchId?: string; providerKey?: string; currency?: "YER"; periodStart?: string; periodEnd?: string; evidenceDocumentId?: string } | null;
  if (!body || !body.providerKey?.trim() || body.currency !== "YER" || !body.periodStart || !body.periodEnd || !body.evidenceDocumentId?.trim()) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات كشف المحفظة غير مكتملة" } }, { status: 400 });
  try {
    const result = await registerOperatorSettlementStatement(body as Required<typeof body>, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تسجيل كشف المحفظة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
