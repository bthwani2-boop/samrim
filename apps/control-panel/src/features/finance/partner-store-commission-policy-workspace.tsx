"use client";

import type { PartnerStoreCommissionPoliciesResponse, PartnerStoreCommissionPolicy } from "@bthwani/dsh";
import { useState } from "react";

const modes = [
  { key: "BTHWANI_CAPTAIN", label: "توصيل بثواني" },
  { key: "PARTNER_CAPTAIN", label: "توصيل المتجر" },
  { key: "CUSTOMER_PICKUP", label: "استلم بنفسك من المتجر" },
] as const;

type FulfillmentMode = (typeof modes)[number]["key"];
type Policy = PartnerStoreCommissionPolicy & Readonly<{ fulfillmentMode: FulfillmentMode }>;

function formatPercent(rateBps: number) {
  return `${(rateBps / 100).toFixed(2)}%`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PartnerStoreCommissionPolicyWorkspace() {
  const [storeId, setStoreId] = useState("");
  const [loadedStoreId, setLoadedStoreId] = useState("");
  const [policies, setPolicies] = useState<readonly Policy[]>([]);
  const [rates, setRates] = useState<Record<FulfillmentMode, string>>({ BTHWANI_CAPTAIN: "", PARTNER_CAPTAIN: "", CUSTOMER_PICKUP: "" });
  const [reason, setReason] = useState("");
  const [busyMode, setBusyMode] = useState<FulfillmentMode | "read" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function readPolicies(id = storeId.trim()): Promise<boolean> {
    if (!id || id.length > 128) {
      setError("أدخل معرّف المتجر أولًا.");
      return false;
    }
    setBusyMode("read");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/finance/partner-store-commission-policies?storeId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json() as Partial<PartnerStoreCommissionPoliciesResponse> & { error?: { message?: string } };
      if (!response.ok || body.storeId !== id || !Array.isArray(body.policies) || body.policies.length !== 3) throw new Error(body.error?.message || "تعذر قراءة سياسات عمولة المتجر.");
      const current = body.policies as readonly Policy[];
      setPolicies(current);
      setRates({
        BTHWANI_CAPTAIN: (current.find((item) => item.fulfillmentMode === "BTHWANI_CAPTAIN")?.commissionRateBps ?? 0) / 100 + "",
        PARTNER_CAPTAIN: (current.find((item) => item.fulfillmentMode === "PARTNER_CAPTAIN")?.commissionRateBps ?? 0) / 100 + "",
        CUSTOMER_PICKUP: (current.find((item) => item.fulfillmentMode === "CUSTOMER_PICKUP")?.commissionRateBps ?? 0) / 100 + "",
      });
      setLoadedStoreId(id);
      setMessage("تمت قراءة النسب الحالية من WLT.");
      return true;
    } catch (value) {
      setPolicies([]);
      setLoadedStoreId("");
      setError(value instanceof Error ? value.message : "تعذر قراءة سياسات عمولة المتجر.");
      return false;
    } finally {
      setBusyMode(null);
    }
  }

  async function save(mode: FulfillmentMode) {
    const selected = policies.find((item) => item.fulfillmentMode === mode);
    const percent = Number(rates[mode]);
    const commissionRateBps = Math.round(percent * 100);
    if (!selected || loadedStoreId !== storeId.trim() || !Number.isFinite(percent) || commissionRateBps < 0 || commissionRateBps > 10000 || Math.abs(percent * 100 - commissionRateBps) > 0.000001 || Array.from(reason.trim()).length < 8) {
      setError("راجع نسبة العمولة وسبب التغيير، ثم أعد قراءة بيانات المتجر عند تغيّر معرّفه.");
      return;
    }
    if (commissionRateBps === selected.commissionRateBps) {
      setError("النسبة الجديدة مطابقة للنسبة الحالية.");
      return;
    }
    setBusyMode(mode);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/partner-store-commission-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ storeId: loadedStoreId, fulfillmentMode: mode, commissionRateBps, expectedVersion: selected.policyVersion, reason: reason.trim() }),
      });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذر حفظ نسبة العمولة.");
      setPolicies((current) => current.map((item) => item.fulfillmentMode === mode ? body.policy! : item));
      setRates((current) => ({ ...current, [mode]: String(body.policy!.commissionRateBps / 100) }));
      setReason("");
      if (await readPolicies(loadedStoreId)) setMessage("تم حفظ النسبة وإضافة سجل تدقيق. النسبة الجديدة تخص الطلبات التي تُنشأ بعد هذا التغيير.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر حفظ نسبة العمولة.");
    } finally {
      setBusyMode(null);
    }
  }

  return <section className="access-card" aria-labelledby="partner-store-commission-title">
    <div className="finance-toolbar">
      <div><p className="eyebrow">صلاحية Finance · الحقيقة المالية في WLT</p><h2 id="partner-store-commission-title">عمولات المتجر حسب وضع التنفيذ</h2></div>
    </div>
    <p className="muted">عند تهيئة المتجر، تُنسخ نسبة الشريك المالية الحالية إلى الأوضاع الثلاثة. نسبة العمولة تُحسب على قيمة المنتجات فقط ولا تشمل رسوم التوصيل؛ لا توجد رسوم لتوصيل المتجر في الإصدار الأول. يمكن تعديل كل وضع على حدة. يحفظ WLT سبب التغيير وهوية الموظف وإصدار السياسة؛ الطلبات السابقة تحتفظ بنسبة العمولة التي سُجلت معها وقت إنشائها.</p>
    <div className="form-grid">
      <label className="field-label" htmlFor="partner-store-commission-store-id">معرّف المتجر<input id="partner-store-commission-store-id" value={storeId} onChange={(event) => setStoreId(event.target.value)} maxLength={128} disabled={busyMode !== null} placeholder="store-id" /></label>
      <button className="button button-secondary" type="button" onClick={() => void readPolicies()} disabled={busyMode !== null || !storeId.trim()}>{busyMode === "read" ? "جارٍ قراءة النسب…" : "قراءة نسب المتجر"}</button>
    </div>
    {policies.length > 0 ? <>
      <p className="muted">النسب المحمّلة تخص المتجر: {loadedStoreId}</p>
      <div className="form-grid" role="group" aria-label="نسب العمولة حسب وضع التنفيذ">
        {modes.map(({ key, label }) => {
          const policy = policies.find((item) => item.fulfillmentMode === key);
          if (!policy) return null;
          return <div className="access-card" key={key}>
            <div className="finance-toolbar"><div><p className="eyebrow">الإصدار {policy.policyVersion}</p><h3>{label}</h3></div><strong>{formatPercent(policy.commissionRateBps)}</strong></div>
            <label className="field-label" htmlFor={`commission-rate-${key}`}>النسبة الجديدة (%)<input id={`commission-rate-${key}`} type="number" min="0" max="100" step="0.01" value={rates[key]} onChange={(event) => setRates((current) => ({ ...current, [key]: event.target.value }))} disabled={busyMode !== null} /></label>
            <p className="muted">آخر تحديث: {formatTimestamp(policy.updatedAt)}{policy.changedByActorId ? ` · غيّره ${policy.changedByActorId}` : " · النسبة الابتدائية من ملف الشريك"}</p>
            {policy.changeReason ? <p className="muted">سبب آخر تغيير: {policy.changeReason}</p> : null}
            <button className="button button-primary" type="button" onClick={() => void save(key)} disabled={busyMode !== null || Array.from(reason.trim()).length < 8 || loadedStoreId !== storeId.trim()}>{busyMode === key ? "جارٍ حفظ النسبة…" : `حفظ نسبة ${label}`}</button>
          </div>;
        })}
      </div>
      <label className="field-label" htmlFor="partner-store-commission-reason">سبب التغيير (إلزامي، 8 إلى 500 حرف)<textarea id="partner-store-commission-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} rows={3} disabled={busyMode !== null} placeholder="اشرح سبب تعديل هذه النسبة" /></label>
    </> : null}
    {error ? <p className="validation-error" role="alert">{error}</p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
  </section>;
}
