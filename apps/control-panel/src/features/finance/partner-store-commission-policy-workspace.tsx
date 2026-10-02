"use client";

import type { CommercialStoreType, CommercialStoreTypeListResponse, CommerceVertical, CommerceVerticalListResponse, PartnerStoreCommissionPoliciesResponse, PartnerStoreCommissionPolicy } from "@bthwani/dsh";
import { useEffect, useState } from "react";

const modes = [
  { key: "BTHWANI_CAPTAIN", label: "توصيل بثواني" },
  { key: "PARTNER_CAPTAIN", label: "توصيل المتجر" },
  { key: "CUSTOMER_PICKUP", label: "استلام من المتجر" },
] as const;

type FulfillmentMode = (typeof modes)[number]["key"];
type Policy = PartnerStoreCommissionPolicy & Readonly<{ fulfillmentMode: FulfillmentMode }>;
type StoreTypeOption = Readonly<{ type: CommercialStoreType; vertical: CommerceVertical }>;

function formatPercent(rateBps: number) { return `${(rateBps / 100).toFixed(2)}%`; }
function saveLabel(busy: boolean, policy: Policy | undefined, label: string): string {
  if (busy) return "جارٍ الحفظ…";
  if (policy) return `حفظ نسبة ${label}`;
  return `إنشاء سياسة ${label}`;
}
function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function apiMessage(value: unknown) {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return "تعذر تحميل سجل أنواع المتاجر.";
}

export function PartnerStoreCommissionPolicyWorkspace() {
  const [options, setOptions] = useState<ReadonlyArray<StoreTypeOption>>([]);
  const [selectedTypeID, setSelectedTypeID] = useState("");
  const [loadedTypeID, setLoadedTypeID] = useState("");
  const [policies, setPolicies] = useState<readonly Policy[]>([]);
  const [rates, setRates] = useState<Record<FulfillmentMode, string>>({ BTHWANI_CAPTAIN: "", PARTNER_CAPTAIN: "", CUSTOMER_PICKUP: "" });
  const [reason, setReason] = useState("");
  const [busyMode, setBusyMode] = useState<FulfillmentMode | "load" | "registry" | null>("registry");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    async function loadRegistry() {
      setBusyMode("registry");
      setError("");
      try {
        const verticalResponse = await fetch("/api/catalog/verticals", { cache: "no-store" });
        const verticalBody = await verticalResponse.json() as unknown;
        if (!verticalResponse.ok || !verticalBody || typeof verticalBody !== "object" || !("verticals" in verticalBody) || !Array.isArray(verticalBody.verticals)) throw new Error(apiMessage(verticalBody));
        const verticals = (verticalBody as CommerceVerticalListResponse).verticals.filter((item) => item.active);
        const grouped = await Promise.all(verticals.map(async (vertical) => {
          const response = await fetch(`/api/catalog/commercial-store-types?verticalId=${encodeURIComponent(vertical.id)}`, { cache: "no-store" });
          const body = await response.json() as unknown;
          if (!response.ok || !body || typeof body !== "object" || !("storeTypes" in body) || !Array.isArray(body.storeTypes)) throw new Error(apiMessage(body));
          return (body as CommercialStoreTypeListResponse).storeTypes.filter((type) => type.active).map((type) => ({ type, vertical }));
        }));
        if (current) setOptions(grouped.flat());
      } catch (cause) {
        if (current) { setOptions([]); setError(cause instanceof Error ? cause.message : "تعذر تحميل سجل أنواع المتاجر."); }
      } finally { if (current) setBusyMode(null); }
    }
    void loadRegistry();
    return () => { current = false; };
  }, []);

  async function readPolicies(typeID = selectedTypeID.trim()): Promise<boolean> {
    if (!typeID || typeID.length > 128) { setError("اختر نوع متجر أولًا."); return false; }
    setBusyMode("load"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/finance/commercial-store-type-commission-policies?commercialStoreTypeId=${encodeURIComponent(typeID)}`, { cache: "no-store" });
      const body = await response.json() as Partial<PartnerStoreCommissionPoliciesResponse> & { error?: { message?: string } };
      if (!response.ok || body.commercialStoreTypeId !== typeID || !Array.isArray(body.policies) || body.policies.length > modes.length) throw new Error(body.error?.message || "تعذر قراءة سياسة العمولة لهذا النوع.");
      const current = body.policies as readonly Policy[];
      setPolicies(current);
      setRates(Object.fromEntries(modes.map(({ key }) => {
        const policy = current.find((item) => item.fulfillmentMode === key);
        return [key, policy ? String(policy.commissionRateBps / 100) : ""];
      })) as Record<FulfillmentMode, string>);
      setLoadedTypeID(typeID);
      setMessage("تمت قراءة السياسات المركزية لهذا النوع من WLT.");
      return true;
    } catch (cause) {
      setPolicies([]); setLoadedTypeID("");
      setError(cause instanceof Error ? cause.message : "تعذر قراءة سياسة العمولة.");
      return false;
    } finally { setBusyMode(null); }
  }

  async function save(mode: FulfillmentMode) {
    const selected = policies.find((item) => item.fulfillmentMode === mode);
    const percent = Number(rates[mode]);
    const commissionRateBps = Math.round(percent * 100);
    if (!selectedTypeID || loadedTypeID !== selectedTypeID || !Number.isFinite(percent) || commissionRateBps < 0 || commissionRateBps > 10000 || Math.abs(percent * 100 - commissionRateBps) > 0.000001 || Array.from(reason.trim()).length < 8) {
      setError("أدخل نسبة صحيحة وسبب التغيير، ثم أعد قراءة النوع قبل الحفظ."); return;
    }
    if (commissionRateBps === selected?.commissionRateBps) { setError("النسبة الجديدة مطابقة للنسبة الحالية."); return; }
    setBusyMode(mode); setError(""); setMessage("");
    try {
      const response = await fetch("/api/finance/commercial-store-type-commission-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ commercialStoreTypeId: loadedTypeID, fulfillmentMode: mode, commissionRateBps, expectedVersion: selected?.policyVersion ?? 0, reason: reason.trim() }),
      });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذر حفظ سياسة العمولة.");
      setReason("");
      if (await readPolicies(loadedTypeID)) setMessage("تم حفظ السياسة مع سجل التدقيق. الطلبات السابقة تحتفظ بلقطة سياستها عند الإنشاء.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ سياسة العمولة."); }
    finally { setBusyMode(null); }
  }

  const selectedType = options.find(({ type }) => type.id === selectedTypeID)?.type;

  return <section className="access-card" aria-labelledby="partner-store-commission-title">
    <div className="finance-toolbar">
      <div><p className="eyebrow">صلاحية Finance · المالك المالي WLT</p><h2 id="partner-store-commission-title">عمولة المنصة حسب نوع المتجر</h2></div>
    </div>
    <p className="muted">كل نوع تجاري له نسب مركزية حسب وضع التنفيذ؛ جميع المتاجر المصنفة بالنوع نفسه تستخدم السياسة ذاتها. لا ينسخ النظام نسبة من ملف الشريك، ولا توجد قيمة افتراضية. تحفظ الطلبات لقطة النسبة وإصدار السياسة اللذين استخدما عند إنشائها.</p>
    <div className="form-grid">
      <label className="field-label" htmlFor="partner-store-commission-type"><span>نوع المتجر التجاري</span>
        <select id="partner-store-commission-type" value={selectedTypeID} onChange={(event) => { setSelectedTypeID(event.target.value); setLoadedTypeID(""); setPolicies([]); setError(""); setMessage(""); }} disabled={busyMode !== null || options.length === 0}>
          <option value="">اختر نوع المتجر</option>
          {options.map(({ type, vertical }) => <option key={type.id} value={type.id}>{vertical.nameAr} · {type.nameAr}</option>)}
        </select>
      </label>
      <button className="button button-secondary" type="button" onClick={() => void readPolicies()} disabled={busyMode !== null || !selectedTypeID}>{busyMode === "load" ? "جارٍ القراءة…" : "قراءة السياسة"}</button>
    </div>
    {busyMode === "registry" ? <output>جارٍ تحميل الأنواع التجارية النشطة…</output> : null}
    {!error && busyMode !== "registry" && options.length === 0 ? <p className="muted">لا توجد أنواع متاجر نشطة يمكن ربط سياسة بها.</p> : null}
    {policies.length >= 0 && loadedTypeID ? <>
      <p className="muted">النوع المختار: <strong>{selectedType?.nameAr ?? loadedTypeID}</strong>{selectedType ? ` · ${selectedType.verticalId}` : ""}</p>
      <fieldset className="form-grid"><legend>سياسات العمولة حسب وضع التنفيذ</legend>
        {modes.map(({ key, label }) => {
          const policy = policies.find((item) => item.fulfillmentMode === key);
          return <div className="access-card" key={key}>
            <div className="finance-toolbar"><div><p className="eyebrow">{policy ? `الإصدار ${policy.policyVersion}` : "لا توجد سياسة بعد"}</p><h3>{label}</h3></div><strong>{policy ? formatPercent(policy.commissionRateBps) : "غير محددة"}</strong></div>
            <label className="field-label" htmlFor={`commission-rate-${key}`}>نسبة العمولة (%)<input id={`commission-rate-${key}`} type="number" min="0" max="100" step="0.01" value={rates[key]} onChange={(event) => setRates((current) => ({ ...current, [key]: event.target.value }))} disabled={busyMode !== null} /></label>
            {policy ? <p className="muted">آخر تحديث: {formatTimestamp(policy.updatedAt)}{policy.changedByActorId ? ` · غيّره ${policy.changedByActorId}` : ""}</p> : <p className="muted">يلزم إنشاء السياسة قبل استخدام هذا الوضع للطلبات.</p>}
            {policy?.changeReason ? <p className="muted">سبب آخر تغيير: {policy.changeReason}</p> : null}
            <button className="button button-primary" type="button" onClick={() => void save(key)} disabled={busyMode !== null || Array.from(reason.trim()).length < 8 || loadedTypeID !== selectedTypeID || rates[key] === ""}>{saveLabel(busyMode === key, policy, label)}</button>
          </div>;
        })}
      </fieldset>
      <label className="field-label" htmlFor="partner-store-commission-reason">سبب التغيير (إلزامي، 8 إلى 500 حرف)<textarea id="partner-store-commission-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} rows={3} disabled={busyMode !== null} placeholder="وضح سبب اعتماد أو تعديل النسبة" /></label>
    </> : null}
    {error ? <p className="validation-error" role="alert">{error}</p> : null}
    {message ? <output className="success">{message}</output> : null}
  </section>;
}
