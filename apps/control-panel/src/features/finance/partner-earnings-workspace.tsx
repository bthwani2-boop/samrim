"use client";

import { financialProfileStateLabel, formatMoney, settlementPeriodLabel, type PartnerCommissionRemittanceResponse, type PartnerFinancialSummary } from "@bthwani/dsh";
import { useState } from "react";

type PendingRemittance = Readonly<{ amountMinor: number; remittanceReference: string; evidenceReference: string; idempotencyKey: string; correlationId: string }>;

export function PartnerEarningsWorkspace() {
  const [partnerActorId, setPartnerActorId] = useState("");
  const [summary, setSummary] = useState<PartnerFinancialSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [pending, setPending] = useState<PendingRemittance | null>(null);
  const [receipt, setReceipt] = useState<PartnerCommissionRemittanceResponse | null>(null);
  const read = async (actorId = partnerActorId) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/partner-earnings?partnerActorId=${encodeURIComponent(actorId.trim())}`, { cache: "no-store" });
      const body = await response.json() as { summary?: PartnerFinancialSummary; error?: { message?: string } };
      if (!response.ok || !body.summary) throw new Error(body.error?.message || "تعذر قراءة مستحقات الشريك");
      setSummary(body.summary);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة مستحقات الشريك"); } finally { setBusy(false); }
  };
  const submitRemittance = async () => {
    if (!summary || !partnerActorId.trim()) return;
    let transaction = pending;
    if (!transaction) {
      const amountMinor = Number(amount);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > summary.outstandingCommissionReceivableMinor || !reference.trim() || !evidence.trim()) {
        setError("أدخل مبلغًا صحيحًا لا يتجاوز العمولة المستحقة، مع مرجع الحوالة ومرجع إثبات التحقق.");
        return;
      }
      transaction = { amountMinor, remittanceReference: reference.trim(), evidenceReference: evidence.trim(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
      setPending(transaction);
    }
    setBusy(true); setError(""); setReceipt(null);
    try {
      const response = await fetch("/api/finance/partner-earnings", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": transaction.idempotencyKey, "X-Correlation-ID": transaction.correlationId }, body: JSON.stringify({ partnerActorId: partnerActorId.trim(), amountMinor: transaction.amountMinor, remittanceReference: transaction.remittanceReference, evidenceReference: transaction.evidenceReference }) });
      const body = await response.json() as PartnerCommissionRemittanceResponse | { error?: { message?: string } };
      if (!response.ok) {
        const message = (body as { error?: { message?: string } }).error?.message || "تعذر تسجيل الحوالة";
        if (response.status < 500) setPending(null);
        throw new Error(response.status >= 500 ? `${message}؛ احتفظنا بنفس مرجع العملية لإعادة المحاولة بأمان.` : message);
      }
      setReceipt(body as PartnerCommissionRemittanceResponse);
      setPending(null); setAmount(""); setReference(""); setEvidence("");
      await read(partnerActorId);
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تسجيل الحوالة؛ أعد المحاولة بنفس العملية.");
    } finally { setBusy(false); }
  };
  return <section className="access-card" aria-labelledby="partner-earnings-title"><div className="finance-toolbar"><div><p className="eyebrow">السجل المالي · قراءة موثوقة</p><h2 id="partner-earnings-title">مستحقات الشريك</h2></div></div><p className="muted">تُعرض مستحقات الطلبات وعمولة المنصة والرصيد المفتوح لعمولات الاستلام النقدي من السجل المالي.</p><label className="field-label" htmlFor="partner-earnings-actor">معرّف الشريك<input id="partner-earnings-actor" value={partnerActorId} onChange={(event) => setPartnerActorId(event.target.value)} placeholder="partner_…" disabled={busy || Boolean(pending)} /></label><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || Boolean(pending) || !partnerActorId.trim()}>{busy ? "جارٍ المعالجة…" : "قراءة المستحقات"}</button>{error ? <p className="validation-error" role="alert">{error}</p> : null}{receipt ? <p role="status">سُجلت الحوالة {receipt.remittance.remittanceReference} بمبلغ {formatMoney(receipt.remittance.amountMinor, receipt.remittance.currency)}، وأُثبتها المشغّل {receipt.remittance.verifiedBy}.</p> : null}{summary ? <section className="finance-summary-grid" aria-label="ملخص مستحقات الشريك"><article className="finance-summary-card"><span>صافي المستحق</span><strong>{formatMoney(summary.earnedMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>عمولة المنصة</span><strong>{formatMoney(summary.commissionMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>عمولة استلام نقدي مفتوحة</span><strong>{formatMoney(summary.outstandingCommissionReceivableMinor, summary.currency)}</strong></article><article className="finance-summary-card"><span>الطلبات المسلّمة</span><strong>{summary.orderCount.toLocaleString("ar-YE")}</strong></article><p className="muted">فترة التسوية: {settlementPeriodLabel(summary.settlementPeriod)} · الحالة المالية: {financialProfileStateLabel(summary.profileState)}</p></section> : null}{summary && summary.outstandingCommissionReceivableMinor > 0 ? <section aria-label="تسجيل حوالة عمولة الاستلام النقدي"><h3>تسجيل حوالة مستلمة من الشريك</h3><p className="muted">يسجل هذا الإجراء مبلغًا تم استلامه والتحقق منه فعليًا. المتجر يحتفظ بقيمة مبيعاته؛ هذه الحوالة تخص عمولة بثواني فقط. لا تسجلها قبل التحقق من وصول المبلغ.</p><label className="field-label" htmlFor="commission-remittance-amount">المبلغ بالريال اليمني<input id="commission-remittance-amount" inputMode="numeric" pattern="[0-9]*" value={pending ? String(pending.amountMinor) : amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} disabled={busy || Boolean(pending)} /></label><label className="field-label" htmlFor="commission-remittance-reference">مرجع الحوالة<input id="commission-remittance-reference" value={pending?.remittanceReference ?? reference} onChange={(event) => setReference(event.target.value)} maxLength={128} disabled={busy || Boolean(pending)} /></label><label className="field-label" htmlFor="commission-remittance-evidence">مرجع إثبات التحقق<input id="commission-remittance-evidence" value={pending?.evidenceReference ?? evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={512} disabled={busy || Boolean(pending)} /></label>{pending ? <p className="muted">توجد محاولة سابقة قد يكون ردها انقطع. إعادة الإرسال ستستخدم مفتاح العملية والبيانات نفسيهما.</p> : null}<button className="button button-primary" type="button" onClick={() => void submitRemittance()} disabled={busy}>{busy ? "جارٍ تسجيل الحوالة…" : pending ? "إعادة المحاولة بنفس العملية" : "تسجيل الحوالة بعد التحقق"}</button></section> : null}</section>;
}
