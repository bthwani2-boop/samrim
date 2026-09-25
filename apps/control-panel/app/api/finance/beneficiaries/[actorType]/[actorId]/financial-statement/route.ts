import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorBeneficiaryFinancialStatement } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";

const actorTypes = new Set(["customer", "partner", "captain", "field"]);

export async function GET(request: Request, context: Readonly<{ params: Promise<{ actorType: string; actorId: string }> }>) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const { actorType, actorId } = await context.params;
  const query = new URL(request.url).searchParams;
  if (!actorTypes.has(actorType)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "beneficiary type is invalid" } }, { status: 400 });
  try {
    const result = await readOperatorBeneficiaryFinancialStatement(actorType as "customer" | "partner" | "captain" | "field", actorId, query.get("from") ?? "", query.get("to") ?? "", query.get("cursor") ?? "", { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة كشف المستفيد المالي" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
