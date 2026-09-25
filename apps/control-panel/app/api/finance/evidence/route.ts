import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, uploadOperatorFinanceEvidence, type FinanceEvidencePurpose } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  try {
    const form = await request.formData();
    const purpose = form.get("purpose");
    const file = form.get("file");
    if ((purpose !== "TRANSFER_RECEIPT" && purpose !== "SETTLEMENT_STATEMENT") || !(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "اختر ملفاً صالحاً لا يتجاوز 10 ميغابايت" } }, { status: 400 });
    const result = await uploadOperatorFinanceEvidence(purpose as FinanceEvidencePurpose, file, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر حفظ مستند المالية" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
