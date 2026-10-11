"use client";
import { TextArea } from "@bthwani/design-system/web";

import type { PartnerFinancialTermsPolicy } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";

type ReadState = "loading" | "ready" | "missing" | "error";
type SettlementPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

const settlementLabels: Record<SettlementPeriod, string> = { DAILY: "يومية", WEEKLY: "أسبوعية", MONTHLY: "شهرية" };

function saveActionLabel(busy: boolean, hasPolicy: boolean): string {
  if (busy) return "جارٍ التفعيل والتحقق…";
  if (hasPolicy) return "تحديث الشروط";
  return "إنشاء الشروط الأولى";
}

export function PartnerFinancialTermsPolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true && state.identity.permissions?.includes("finance") === true;
  const [policy, setPolicy] = useState<PartnerFinancialTermsPolicy | null>(null);
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
        setSettlementPeriod("");
        setReadState("missing");
        return false;
      }
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذرت قراءة السياسة النشطة من السجل المالي.");
      setPolicy(body.policy);
      setSettlementPeriod(body.policy.settlementPeriod);
      setReadState("ready");
      return true;
    } catch (value) {
      setReadState("error");
      setError(value instanceof Error ? value.message : "تعذرت قراءة السياسة النشطة من السجل المالي.");
      return false;
    }
  }, []);

  useEffect(() => { void read(); }, [read]);

  const validReason = reason.trim().length >= 5 && reason.trim().length <= 500;
  const saveLabel = saveActionLabel(busy, Boolean(policy));

  async function save() {
    if (!canEdit || (readState !== "ready" && readState !== "missing") || !settlementPeriod || !validReason) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/partner-financial-terms-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ settlementPeriod, expectedVersion: policy?.version ?? 0, reason: reason.trim() }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذر تفعيل شروط الشريك المالية.");
      if (!await read()) throw new Error("أُرسل التغيير، لكن تعذرت مطابقة القراءة المعتمدة من السجل المالي.");
      setMessage("تم تفعيل شروط التسوية.");
      setReason("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تفعيل شروط الشريك المالية.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="form-section" aria-label="إعداد فترة تسوية الشريك">
    <div className="action-row">
      <button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || readState === "loading"}>إعادة القراءة</button>
    </div>

    {readState === "loading" ? <p role="status">جارٍ قراءة الشروط المعتمدة من السجل المالي…</p> : null}
    {readState === "missing" ? <p className="managed-status managed-status-warning" role="status">لم تُحدّد فترة التسوية؛ يلزم تفعيلها قبل اعتماد الشريك.</p> : null}
    {readState === "error" ? <p className="validation-error" role="alert">{error || "تعذرت القراءة؛ التعديل متوقف حتى نجاح القراءة."}</p> : null}
    {policy ? <p className="muted">فترة التسوية: {settlementLabels[policy.settlementPeriod]}</p> : null}
    {(readState === "ready" || readState === "missing") ? <>
      <div className="form-grid">
        <label className="field-label" htmlFor="partner-terms-settlement">فترة تسوية الشريك<select id="partner-terms-settlement" value={settlementPeriod} onChange={(event) => setSettlementPeriod(event.target.value as SettlementPeriod | "")} disabled={busy || !canEdit}><option value="">اختر الفترة</option><option value="DAILY">يومية</option><option value="WEEKLY">أسبوعية</option><option value="MONTHLY">شهرية</option></select></label>
      </div>
      <label className="field-label" htmlFor="partner-terms-reason">سبب التفعيل أو التغيير<TextArea aria-describedby="partner-terms-reason-hint" className="resize-none" id="partner-terms-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} rows={3} disabled={busy || !canEdit} /><small id="partner-terms-reason-hint">٥–٥٠٠ حرف؛ عمولة المتجر تبقى وفق اتفاقيته.</small></label>
      {error ? <p className="validation-error" role="alert">{error}</p> : null}
      {message ? <p className="success" role="status">{message}</p> : null}
      <div className="action-row"><button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || !canEdit || !settlementPeriod || !validReason}>{saveLabel}</button></div>
    </> : null}
  </section>;
}
