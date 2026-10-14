import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

type WalletCompensationResponse = Readonly<{
  walletCompensation: Readonly<{
    caseId: string; orderId: string; customerActorId: string;
    amountMinor: number; currency: string; ledgerTransactionId: string;
  }>;
  idempotentReplay: boolean;
}>;

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "يلزم تسجيل الدخول." } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "تتطلب العملية صلاحية المالية." } }, { status: 403 });
  }
  const input = await request.json().catch(() => null) as { orderId?: unknown; adjustmentId?: unknown } | null;
  const orderId = typeof input?.orderId === "string" ? input.orderId.trim() : "";
  const adjustmentId = typeof input?.adjustmentId === "string" ? input.adjustmentId.trim() : "";
  if (!orderId || orderId.length > 128 || !adjustmentId || adjustmentId.length > 128) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "بيانات الطلب والتعديل غير صحيحة." } }, { status: 400 });
  }
  try {
    const response = await requestDshJson<WalletCompensationResponse>(
      "POST",
      `/dsh/operator/orders/${encodeURIComponent(orderId)}/adjustments/${encodeURIComponent(adjustmentId)}/wallet-compensation`,
      {},
      {
        "X-Acting-Actor-ID": identity.subject,
        "Idempotency-Key": `wallet-credit-${crypto.randomUUID()}`,
        "X-Correlation-ID": `wallet-credit-${crypto.randomUUID()}`,
      },
    );
    return NextResponse.json(response.payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) {
      return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر تنفيذ تعويض المحفظة." } }, { status: 500 });
    }
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
