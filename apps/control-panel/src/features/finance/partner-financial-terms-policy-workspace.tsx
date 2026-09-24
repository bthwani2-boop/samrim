"use client";

import type { PartnerFinancialTermsPolicy } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";

type ReadState = "loading" | "ready" | "missing" | "error";
type SettlementPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

const settlementLabels: Record<SettlementPeriod, string> = { DAILY: "يومية", WEEKLY: "أسبوعية", MONTHLY: "شهرية" };

export function PartnerFinancialTermsPolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true && state.identity.permissions?.includes("finance") === true;
  const [policy, setPolicy] = useState<PartnerFinancialTermsPolicy | null>(null);
  const [commissionPercent, setCommissionPercent] = useState("");
  const [settlementPeriod, setSettlementPeriod] = useState<SettlementPeriod | "">("");
  const [reason, setReason] = useState("");
  const [readState, setReadState] = useState<ReadState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    setReadState("loading");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/partner-financial-terms-policy", { cache: "no-store" });
      const body = await response.json() as { policy?: PartnerFinancialTermsPolicy; error?: { message?: string } };
      if (response.status === 404) {
        setPolicy(null);
        setCommissionPercent("");
        setSettlementPeriod("");
        setReadState("missing");
        return false;
      }
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذرت قراءة السياسة النشطة من WLT.");
      setPolicy(body.policy);
      setCommissionPercent(String(body.policy.commissionRateBps / 100));
      setSettlementPeriod(body.policy.settlementPeriod);
      setReadState("ready");
      return true;
    } catch (value) {
      setReadState("error");
      setError(value instanceof Error ? value.message : "تعذرت قراءة السياسة النشطة من WLT.");
      return false;
    }
  }, []);

  useEffect(() => { void read(); }, [read]);

  const commission = Number(commissionPercent);
  const validCommission = commissionPercent.trim() !== "" && Number.isFinite(commission) && commission >= 0 && commission <= 100;
  const validReason = reason.trim().length >= 5 && reason.trim().length <= 500;

  async function save() {
    if (!canEdit || (readState !== "ready" && readState !== "missing") || !validCommission || !settlementPeriod || !validReason) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/partner-financial-terms-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ commissionRateBps: Math.round(commission * 100), settlementPeriod, expectedVersion: policy?.version ?? 0, reason: reason.trim() }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذر تفعيل شروط الشريك المالية.");
      if (!await read()) throw new Error("أُرسل التغيير، لكن تعذرت مطابقة القراءة الكانونية من WLT.");
      setMessage("تم تفعيل نسخة الشروط والتحقق من قراءتها من WLT.");
      setReason("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تفعيل شروط الشريك المالية.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="access-card" aria-labelledby="partner-financial-terms-title">
    <div className="finance-toolbar">
      <div><p className="eyebrow">مركز السياسات · WLT · يتطلب Finance</p><h2 id="partner-financial-terms-title">شروط الشريك المالية</h2></div>
      <button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || readState === "loading"}>إعادة القراءة</button>
    </div>
    <p className="muted">تحدد هذه السياسة نسبة عمولة المنصة وفترة تسوية ملف الشريك عند اعتماده. تُحفظ كل مراجعة كإصدار مستقل؛ ويظل لكل متجر تعديل عمولة منفصل لكل من أوضاع التوصيل الثلاثة.</p>
    {readState === "loading" ? <p role="status">جارٍ قراءة الشروط المعتمدة من WLT…</p> : null}
    {readState === "missing" ? <p className="managed-status managed-status-warning" role="status">لا توجد سياسة مالية نشطة. أدخل القيم المعتمدة هنا قبل اعتماد أو استكمال ربط أي ملف شريك.</p> : null}
    {readState === "error" ? <p className="validation-error" role="alert">{error || "تعذرت القراءة؛ التعديل متوقف حتى نجاح القراءة."}</p> : null}
    {policy ? <p className="muted">الإصدار النشط: {policy.policyVersion} · العمولة: {(policy.commissionRateBps / 100).toFixed(2)}% · التسوية: {settlementLabels[policy.settlementPeriod]}</p> : null}
    {(readState === "ready" || readState === "missing") ? <>
      <div className="form-grid">
        <label className="field-label" htmlFor="partner-terms-commission">عمولة المنصة (%)<input id="partner-terms-commission" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} disabled={busy || !canEdit} /></label>
        <label className="field-label" htmlFor="partner-terms-settlement">فترة تسوية الشريك<select id="partner-terms-settlement" value={settlementPeriod} onChange={(event) => setSettlementPeriod(event.target.value as SettlementPeriod | "")} disabled={busy || !canEdit}><option value="">اختر الفترة</option><option value="DAILY">يومية</option><option value="WEEKLY">أسبوعية</option><option value="MONTHLY">شهرية</option></select></label>
      </div>
      <label className="field-label" htmlFor="partner-terms-reason">سبب التفعيل أو التغيير<textarea id="partner-terms-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} rows={3} disabled={busy || !canEdit} /></label>
      {error ? <p className="validation-error" role="alert">{error}</p> : null}
      {message ? <p className="success" role="status">{message}</p> : null}
      <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || !canEdit || !validCommission || !settlementPeriod || !validReason}>{busy ? "جارٍ التفعيل والتحقق…" : policy ? "تفعيل إصدار جديد" : "إنشاء الإصدار الأول"}</button>
    </> : null}
  </section>;
}
