"use client";

import { financialProfileStateLabel, formatMoney, settlementPeriodLabel, type PartnerFinancialSummary } from "@bthwani/dsh";
import { useState } from "react";

export function PartnerEarningsWorkspace() {
  const [partnerActorId, setPartnerActorId] = useState("");
  const [summary, setSummary] = useState<PartnerFinancialSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/partner-earnings?partnerActorId=${encodeURIComponent(partnerActorId.trim())}`, { cache: "no-store" });
      const body = await response.json() as { summary?: PartnerFinancialSummary; error?: { message?: string } };
      if (!response.ok || !body.summary) throw new Error(body.error?.message || "تعذر قراءة مستحقات الشريك");
      setSummary(body.summary);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة مستحقات الشريك"); } finally { setBusy(false); }
  };
  return <section className="access-card" aria-labelledby="partner-earnings-title"><div className="finance-toolbar"><div><p className="eyebrow">WLT · قراءة مشتقة</p><h2 id="partner-earnings-title">مستحقات الشريك</h2></div></div><p className="muted">هذه القراءة تُظهر المستحقات والعمولة المشتقة من الطلبات المسلّمة والقيد المالي. لا توجد حقول تعديل يدوي.</p><label className="field-label" htmlFor="partner-earnings-actor">معرّف الشريك<input id="partner-earnings-actor" value={partnerActorId} onChange={(event) => setPartnerActorId(event.target.value)} placeholder="partner_…" /></label><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || !partnerActorId.trim()}>{busy ? "جارٍ القراءة…" : "قراءة المستحقات"}</button>{error ? <p className="validation-error" role="alert">{error}</p> : null}{summary ? <section className="finance-summary-grid" aria-label="ملخص مستحقات الشريك"><article className="finance-summary-card"><span>صافي المستحق</span><strong>{formatMoney(summary.earnedMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>عمولة المنصة</span><strong>{formatMoney(summary.commissionMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>الطلبات المسلّمة</span><strong>{summary.orderCount.toLocaleString("ar-YE")}</strong></article><p className="muted">فترة التسوية: {settlementPeriodLabel(summary.settlementPeriod)} · الحالة المالية: {financialProfileStateLabel(summary.profileState)}</p></section> : null}</section>;
}
