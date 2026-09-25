import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorSettlementBatch, dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorSettlementBatches } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const limit = Number(query.get("limit") || "25");
  try {
    const result = await listOperatorSettlementBatches(query.get("status") ?? "", query.get("cursor") ?? "", limit, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة دفعات التسوية" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const body = await request.json().catch(() => null) as { payoutIds?: unknown } | null;
  if (!body || !Array.isArray(body.payoutIds) || body.payoutIds.some((id) => typeof id !== "string")) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "اختر طلبات معتمدة لإنشاء الدفعة" } }, { status: 400 });
  try {
    const result = await createOperatorSettlementBatch(body.payoutIds as string[], { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر إنشاء دفعة التسوية" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
