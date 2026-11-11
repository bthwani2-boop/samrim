import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-transport";
import { submitOperatorLegacyCODRecovery } from "../../../../src/server/dsh/finance-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403 });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const body = await request.json().catch(() => null) as { paymentIntentId?: unknown; evidenceDocumentId?: unknown } | null;
  if (!body || typeof body.paymentIntentId !== "string" || !body.paymentIntentId.trim() || body.paymentIntentId.length > 128 ||
      typeof body.evidenceDocumentId !== "string" || !body.evidenceDocumentId.trim() || body.evidenceDocumentId.length > 128) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "payment and evidence are required" } }, { status: 400 });
  }
  try {
    const result = await submitOperatorLegacyCODRecovery(body.paymentIntentId, body.evidenceDocumentId, {
      operatorActorId: identity.subject,
      idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID(),
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
    });
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر حفظ مراجعة النقد التاريخي" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}