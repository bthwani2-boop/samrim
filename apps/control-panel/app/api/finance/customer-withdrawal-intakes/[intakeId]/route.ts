import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorCustomerWithdrawalIntake } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

export async function GET(_request: Request, context: Readonly<{ params: Promise<{ intakeId: string }> }>) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { intakeId } = await context.params;
  if (!intakeId.trim() || intakeId.length > 128) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "معرّف طلب السحب غير صالح" } }, { status: 400 });
  try {
    const result = await readOperatorCustomerWithdrawalIntake(intakeId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة تفاصيل طلب السحب" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
