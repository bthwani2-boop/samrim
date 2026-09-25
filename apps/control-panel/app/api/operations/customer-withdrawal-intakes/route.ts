import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorCustomerWithdrawalIntake, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("operations")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "صلاحية العمليات مطلوبة" } }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.customerActorId !== "string" || typeof body.providerKey !== "string" || typeof body.walletIdentifier !== "string" || typeof body.requestReason !== "string" || typeof body.requestEvidenceDocumentId !== "string") return NextResponse.json({ error: { code: "INVALID_INPUT", message: "أكمل بيانات طلب السحب ومرفق التفويض" } }, { status: 400 });
  try {
    const result = await createOperatorCustomerWithdrawalIntake({ customerActorId: body.customerActorId, providerKey: body.providerKey, walletIdentifier: body.walletIdentifier, requestReason: body.requestReason, requestEvidenceDocumentId: body.requestEvidenceDocumentId }, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تسجيل طلب سحب العميل" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
