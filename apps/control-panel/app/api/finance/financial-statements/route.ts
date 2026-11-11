import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-transport";
import { listOperatorFinancialStatementSummaries } from "../../../../src/server/dsh/finance-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

const actorTypes = new Set(["customer", "partner", "captain", "field"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType") ?? "";
  if (!actorTypes.has(actorType)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "beneficiary type is invalid" } }, { status: 400 });
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "financial statement period is invalid" } }, { status: 400 });
  }
  try {
    const result = await listOperatorFinancialStatementSummaries(actorType as "customer" | "partner" | "captain" | "field", from, to, query.get("cursor") ?? "", { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة ملخص المستحقات للفترة" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
