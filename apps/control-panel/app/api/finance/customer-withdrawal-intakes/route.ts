import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorCustomerWithdrawalIntakes } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const limit = Number(query.get("limit") || "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "حجم سجل السحب غير صالح" } }, { status: 400 });
  try {
    const result = await listOperatorCustomerWithdrawalIntakes(query.get("status") ?? "", limit, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة طلبات سحب العملاء" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
