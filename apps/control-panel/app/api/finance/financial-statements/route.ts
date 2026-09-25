import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorFinancialStatementSummaries } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

const actorTypes = new Set(["customer", "partner", "captain", "field"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType") ?? "";
  if (!actorTypes.has(actorType)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "beneficiary type is invalid" } }, { status: 400 });
  try {
    const result = await listOperatorFinancialStatementSummaries(actorType as "customer" | "partner" | "captain" | "field", query.get("from") ?? "", query.get("to") ?? "", query.get("cursor") ?? "", { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة ملخص المستحقات للفترة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
