"use client";

import { formatMoney, type FieldFinancialSummary } from "@bthwani/dsh";
import { useState } from "react";

export function FieldEarningsWorkspace() {
  const [fieldActorId, setFieldActorId] = useState("");
  const [summary, setSummary] = useState<FieldFinancialSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/field-earnings?fieldActorId=${encodeURIComponent(fieldActorId.trim())}`, { cache: "no-store" });
      const body = await response.json() as { summary?: FieldFinancialSummary; error?: { message?: string } };
      if (!response.ok || !body.summary) throw new Error(body.error?.message || "تعذر قراءة مستحقات الميداني");
      setSummary(body.summary);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة مستحقات الميداني"); } finally { setBusy(false); }
  };
  return <section className="access-card" aria-labelledby="field-earnings-title"><div className="finance-toolbar"><div><p className="eyebrow">السجل المالي · قراءة موثوقة</p><h2 id="field-earnings-title">مستحقات الميداني</h2></div></div><p className="muted">هذه القراءة تعرض المكافآت التي أثبتها WLT للمتاجر المنشورة، قبل متابعة وجهة التسوية والحجز.</p><label className="field-label" htmlFor="field-earnings-actor">معرّف الميداني<input id="field-earnings-actor" value={fieldActorId} onChange={(event) => setFieldActorId(event.target.value)} placeholder="field_…" /></label><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || !fieldActorId.trim()}>{busy ? "جارٍ القراءة…" : "قراءة المستحقات"}</button>{error ? <p className="validation-error" role="alert">{error}</p> : null}{summary ? <section className="finance-summary-grid" aria-label="ملخص مستحقات الميداني"><article className="finance-summary-card"><span>إجمالي المكتسب</span><strong>{formatMoney(summary.earnedMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>العمولة المثبتة</span><strong>{formatMoney(summary.commissionMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>المتاجر المكتملة</span><strong>{summary.storeCount.toLocaleString("ar-YE")}</strong></article><p className="muted">آخر إثبات: {summary.lastEarningAt ? new Date(summary.lastEarningAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" }) : "لا يوجد بعد"}</p></section> : null}</section>;
}
