export type FinanceAgreementPreview = Readonly<{
  agreementId: string;
  storeId: string;
  storeName: string;
  status: "PARTNER_ACCEPTED";
  partnerAcceptedAt: string;
}>;

// A small, permission-gated preview of the existing canonical Finance queue.
// Reject malformed or cross-state records instead of presenting false decisions.
export function readFinanceAgreementPreview(payload: unknown): readonly FinanceAgreementPreview[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    !("agreements" in payload) || !Array.isArray(payload.agreements) || payload.agreements.length > 3) {
    throw new Error("استجابة اتفاقيات المالية غير صالحة.");
  }
  const items: FinanceAgreementPreview[] = [];
  const seen = new Set<string>();
  for (const raw of payload.agreements) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("بيانات اتفاقية مالية غير صالحة.");
    const item = raw as Record<string, unknown>;
    if (typeof item.agreementId !== "string" || !item.agreementId.trim() ||
      typeof item.storeId !== "string" || !item.storeId.trim() ||
      typeof item.storeName !== "string" ||
      item.status !== "PARTNER_ACCEPTED" ||
      typeof item.partnerAcceptedAt !== "string" || !Number.isFinite(Date.parse(item.partnerAcceptedAt)) ||
      seen.has(item.agreementId)) {
      throw new Error("بيانات اتفاقية مالية غير صالحة.");
    }
    seen.add(item.agreementId);
    items.push({
      agreementId: item.agreementId,
      storeId: item.storeId,
      storeName: item.storeName,
      status: "PARTNER_ACCEPTED",
      partnerAcceptedAt: item.partnerAcceptedAt,
    });
  }
  return items;
}
