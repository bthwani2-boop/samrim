import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorPartnerCommissionReceivables } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

const allowedSorts = ["actor_asc", "actor_desc"] as const;

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  }
  const query = new URL(request.url).searchParams;
  const search = query.get("search")?.trim() ?? "";
  const sort = query.get("sort") ?? "actor_asc";
  const cursor = query.get("cursor") ?? "";
  const rawLimit = query.get("limit") ?? "50";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (search.length > 128 || cursor.length > 1024 || !allowedSorts.includes(sort as typeof allowedSorts[number]) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "مرشحات سجل مستحقات الشركاء غير صالحة" } }, { status: 400 });
  }
  try {
    const result = await listOperatorPartnerCommissionReceivables(search, sort as typeof allowedSorts[number], cursor, limit, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة سجل مستحقات الشركاء" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
