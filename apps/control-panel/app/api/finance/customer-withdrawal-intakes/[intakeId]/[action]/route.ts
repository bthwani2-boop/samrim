import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { acceptOperatorCustomerWithdrawal, activateOperatorCustomerWithdrawalDestination, dshErrorPayload, dshHttpStatus, isDshClientError, prepareOperatorCustomerWithdrawalDestination, rejectOperatorCustomerWithdrawal, verifyOperatorCustomerWithdrawalDestination } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

type RouteContext = Readonly<{ params: Promise<{ intakeId: string; action: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { intakeId, action } = await context.params;
  const body = await request.json().catch(() => null) as { reason?: unknown; evidenceReference?: unknown } | null;
  if (!body) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات الإجراء مطلوبة" } }, { status: 400 });
  if (action !== "activate-destination" && (action === "verify-destination" ? typeof body.evidenceReference !== "string" || body.evidenceReference.trim().length < 1 || body.evidenceReference.trim().length > 512 : typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 512)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: action === "verify-destination" ? "أدخل مرجع دليل تحقق الوجهة" : "أدخل سبباً واضحاً للإجراء" } }, { status: 400 });
  const mutation = { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() };
  try {
    let result: unknown;
    switch (action) {
      case "prepare-destination": result = await prepareOperatorCustomerWithdrawalDestination(intakeId, { reason: String(body.reason) }, mutation); break;
      case "verify-destination": result = await verifyOperatorCustomerWithdrawalDestination(intakeId, String(body.evidenceReference), mutation); break;
      case "activate-destination": result = await activateOperatorCustomerWithdrawalDestination(intakeId, mutation); break;
      case "accept": result = await acceptOperatorCustomerWithdrawal(intakeId, { reason: String(body.reason) }, mutation); break;
      case "reject": result = await rejectOperatorCustomerWithdrawal(intakeId, { reason: String(body.reason) }, mutation); break;
      default: return NextResponse.json({ error: { code: "NOT_FOUND", message: "الإجراء غير معروف" } }, { status: 404 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تنفيذ إجراء طلب السحب" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
