"use client";

import { fieldCommissionScopeLabel, financialPolicyStateLabel, formatMoney } from "@bthwani/dsh";
import { useState } from "react";

type Policy = Readonly<{
  id: string;
  scopeType: "DEFAULT" | "VERTICAL" | "STORE";
  scopeId: string;
  rewardMinor: number;
  roundingUnitMinor: 50;
  state: "ACTIVE" | "RETIRED";
  version: number;
}>;

export function FieldCommissionPolicyWorkspace() {
  const [scopeType, setScopeType] = useState<Policy["scopeType"]>("DEFAULT");
  const [scopeId, setScopeId] = useState("");
  const [rewardMinor, setRewardMinor] = useState("5000");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/field-commission-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ scopeType, scopeId: scopeType === "DEFAULT" ? "" : scopeId.trim(), rewardMinor: Number(rewardMinor), roundingUnitMinor: 50 }),
      });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذر تفعيل سياسة مكافأة الميداني");
      setPolicy(body.policy);
      setMessage("تم تفعيل سياسة مكافأة الميداني بنجاح.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تفعيل سياسة مكافأة الميداني");
    } finally {
      setBusy(false);
    }
  };

  return <section className="access-card" aria-labelledby="field-commission-policy-title">
    <div className="finance-toolbar"><div><p className="eyebrow">سياسة مالية مركزية</p><h2 id="field-commission-policy-title">مكافأة الميداني</h2></div></div>
    <p className="muted">تُستحق المكافأة مرة واحدة عند ظهور المتجر في تطبيق العميل. إخفاء المتجر لاحقًا لا يعكس الاستحقاق، والتقريب المالي ثابت عند 50 ريال.</p>
    <div className="form-grid">
      <label className="field-label" htmlFor="field-commission-scope">نطاق السياسة<select id="field-commission-scope" value={scopeType} onChange={(event) => setScopeType(event.target.value as Policy["scopeType"])} disabled={busy}><option value="DEFAULT">افتراضي</option><option value="VERTICAL">مجال تجاري</option><option value="STORE">متجر</option></select></label>
      {scopeType === "DEFAULT" ? null : <label className="field-label" htmlFor="field-commission-scope-id">معرّف النطاق<input id="field-commission-scope-id" value={scopeId} onChange={(event) => setScopeId(event.target.value)} maxLength={128} disabled={busy} placeholder={scopeType === "VERTICAL" ? "vertical-id" : "store-id"} /></label>}
      <label className="field-label" htmlFor="field-commission-reward">المكافأة (ريال)<input id="field-commission-reward" type="number" min="50" step="50" value={rewardMinor} onChange={(event) => setRewardMinor(event.target.value)} disabled={busy} /></label>
      <p className="muted">وحدة التقريب: 50 ريال — لا يمكن تغييرها من الواجهة.</p>
    </div>
    {error ? <p className="validation-error" role="alert">{error}</p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
    {policy ? <p className="muted">الحالة: {financialPolicyStateLabel(policy.state)} · النطاق: {fieldCommissionScopeLabel(policy.scopeType)} · المكافأة: {formatMoney(policy.rewardMinor, "YER")}</p> : null}
    <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || (scopeType !== "DEFAULT" && !scopeId.trim()) || !Number.isInteger(Number(rewardMinor)) || Number(rewardMinor) < 50}>{busy ? "جارٍ تفعيل الإصدار…" : "تفعيل إصدار سياسة جديد"}</button>
  </section>;
}
