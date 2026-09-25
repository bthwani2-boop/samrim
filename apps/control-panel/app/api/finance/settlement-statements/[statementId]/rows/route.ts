import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, recordOperatorSettlementStatementRow } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request, context: { params: Promise<{ statementId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const body = await request.json().catch(() => null) as { rowSequence?: number; externalTransferReference?: string; walletIdentifier?: string; amountMinor?: number; currency?: "YER"; transactionAt?: string } | null;
  if (!body || !Number.isSafeInteger(body.rowSequence) || !body.externalTransferReference?.trim() || !body.walletIdentifier?.trim() || !Number.isSafeInteger(body.amountMinor) || body.currency !== "YER" || !body.transactionAt) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات صف كشف المحفظة غير مكتملة" } }, { status: 400 });
  try {
    const { statementId } = await context.params;
    const result = await recordOperatorSettlementStatementRow(statementId, body as Required<typeof body>, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تسجيل صف كشف المحفظة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
