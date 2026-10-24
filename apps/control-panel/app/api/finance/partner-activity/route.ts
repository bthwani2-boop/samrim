import { NextResponse } from "next/server";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPartnerFinancialActivity } from "../../../../src/server/dsh/dsh-bff";

const allowedFilters = ["storeId", "kind", "status", "paymentMethod", "search", "from", "to", "cursor", "limit"] as const;

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const partnerActorId = params.get("partnerActorId")?.trim() ?? "";
  if (!partnerActorId || partnerActorId.length > 128) return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
  const filters: Record<string, string> = {};
  for (const key of allowedFilters) {
    const value = params.get(key)?.trim() ?? "";
    if (value.length > (key === "cursor" ? 512 : 128)) return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
    if (value) filters[key] = value;
  }
  try {
    const result = await readOperatorPartnerFinancialActivity(partnerActorId, filters, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) return NextResponse.json(dshErrorPayload(error), { status: dshHttpStatus(error) });
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذرت قراءة السجل المالي للشريك" } }, { status: 500 });
  }
}
