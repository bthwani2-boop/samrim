"use client";
import { TextArea } from "@bthwani/design-system/web";

import type { CommercialStoreType, CommercialStoreTypeListResponse, CommerceVertical, CommerceVerticalListResponse, StoreTypeCommissionDefault, StoreTypeCommissionDefaultsResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";

const modes = [
  { key: "BTHWANI_CAPTAIN", label: "توصيل بثواني" },
  { key: "PARTNER_CAPTAIN", label: "توصيل المتجر" },
  { key: "CUSTOMER_PICKUP", label: "استلام من المتجر" },
] as const;

type FulfillmentMode = (typeof modes)[number]["key"];
type StoreTypeOption = Readonly<{ type: CommercialStoreType; vertical: CommerceVertical }>;

function formatPercent(rateBps: number) { return `${(rateBps / 100).toFixed(2)}%`; }
function saveLabel(busy: boolean, current: StoreTypeCommissionDefault | undefined, label: string): string {
  if (busy) return "جارٍ الحفظ…";
  return current ? `حفظ النسبة المقترحة · ${label}` : `حفظ اقتراح ${label}`;
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

export function StoreTypeCommissionDefaultWorkspace({ readOnly = false }: Readonly<{ readOnly?: boolean }>) {
  const [options, setOptions] = useState<ReadonlyArray<StoreTypeOption>>([]);
  const [selectedTypeID, setSelectedTypeID] = useState("");
  const [loadedTypeID, setLoadedTypeID] = useState("");
  const [defaults, setDefaults] = useState<readonly StoreTypeCommissionDefault[]>([]);
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

  async function readDefaults(typeID = selectedTypeID.trim()): Promise<boolean> {
    if (!typeID || typeID.length > 128) { setError("اختر نوع متجر أولًا."); return false; }
    setBusyMode("load"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/finance/commercial-store-type-commission-defaults?commercialStoreTypeId=${encodeURIComponent(typeID)}`, { cache: "no-store" });
      const body = await response.json() as Partial<StoreTypeCommissionDefaultsResponse> & { error?: { message?: string } };
      if (!response.ok || body.commercialStoreTypeId !== typeID || !Array.isArray(body.defaults) || body.defaults.length > modes.length) throw new Error(body.error?.message || "تعذر قراءة النسب المقترحة لهذا النوع.");
      const current = body.defaults as readonly StoreTypeCommissionDefault[];
      setDefaults(current);
      setRates(Object.fromEntries(modes.map(({ key }) => {
        const value = current.find((item) => item.fulfillmentMode === key);
        return [key, value ? String(value.suggestedCommissionRateBps / 100) : ""];
      })) as Record<FulfillmentMode, string>);
      setLoadedTypeID(typeID);
      setMessage("تمت قراءة النسب المقترحة من السجل المالي. تبقى شروط كل متجر في اتفاقيته الخاصة.");
      return true;
    } catch (cause) {
      setDefaults([]); setLoadedTypeID("");
      setError(cause instanceof Error ? cause.message : "تعذر قراءة النسب المقترحة.");
      return false;
    } finally { setBusyMode(null); }
  }

  async function save(mode: FulfillmentMode) {
    if (readOnly) return;
    const selected = defaults.find((item) => item.fulfillmentMode === mode);
    const percent = Number(rates[mode]);
    const suggestedCommissionRateBps = Math.round(percent * 100);
    if (!selectedTypeID || loadedTypeID !== selectedTypeID || !Number.isFinite(percent) || suggestedCommissionRateBps < 0 || suggestedCommissionRateBps > 10000 || Math.abs(percent * 100 - suggestedCommissionRateBps) > 0.000001 || Array.from(reason.trim()).length < 8) {
      setError("أدخل نسبة صحيحة وسبب التغيير، ثم أعد قراءة النوع قبل الحفظ."); return;
    }
    if (suggestedCommissionRateBps === selected?.suggestedCommissionRateBps) { setError("النسبة الجديدة مطابقة للاقتراح الحالي."); return; }
    setBusyMode(mode); setError(""); setMessage("");
    try {
      const response = await fetch("/api/finance/commercial-store-type-commission-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ commercialStoreTypeId: loadedTypeID, fulfillmentMode: mode, suggestedCommissionRateBps, expectedDefaultVersion: selected?.defaultVersion ?? 0, reason: reason.trim() }),
      });
      const body = await response.json() as { default?: StoreTypeCommissionDefault; error?: { message?: string } };
      if (!response.ok || !body.default) throw new Error(body.error?.message || "تعذر حفظ النسبة المقترحة.");
      setReason("");
      if (await readDefaults(loadedTypeID)) setMessage("تم حفظ النسبة المقترحة مع سجل التدقيق. لا تسري إلا ضمن اتفاقية المتجر المعتمدة.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ النسبة المقترحة."); }
    finally { setBusyMode(null); }
  }

  return <section className="form-section" aria-labelledby="store-type-commission-default-title">
    <div className="section-heading">
      <div><h2 id="store-type-commission-default-title">نسب مقترحة حسب نوع المتجر</h2></div>
    </div>
    <p className="muted">نسب مقترحة للتفاوض؛ لا تغيّر الاتفاقيات النافذة أو الطلبات السابقة، ولا تُطبّق تلقائيًا.{readOnly ? " عرض للقراءة فقط؛ التعديل متاح من قسم السياسات وفق الصلاحيات." : ""}</p>
    <div className="form-grid">
      <label className="field-label" htmlFor="store-type-commission-default-type"><span>نوع المتجر التجاري</span>
        <select id="store-type-commission-default-type" value={selectedTypeID} onChange={(event) => { setSelectedTypeID(event.target.value); setLoadedTypeID(""); setDefaults([]); setError(""); setMessage(""); }} disabled={busyMode !== null || options.length === 0}>
          <option value="">اختر نوع المتجر</option>
          {options.map(({ type, vertical }) => <option key={type.id} value={type.id}>{vertical.nameAr} · {type.nameAr}</option>)}
        </select>
      </label>
      <button className="button button-secondary" type="button" onClick={() => void readDefaults()} disabled={busyMode !== null || !selectedTypeID}>{busyMode === "load" ? "جارٍ القراءة…" : "قراءة النسب المقترحة"}</button>
    </div>
    {busyMode === "registry" ? <output>جارٍ تحميل الأنواع التجارية النشطة…</output> : null}
    {!error && busyMode !== "registry" && options.length === 0 ? <p className="muted">لا توجد أنواع متاجر نشطة يمكن ربط اقتراح بها.</p> : null}
    {loadedTypeID ? <>

      <fieldset className="form-grid" aria-label="نسب مقترحة حسب وضع التنفيذ">
        {modes.map(({ key, label }) => {
          const value = defaults.find((item) => item.fulfillmentMode === key);
          return <div className="form-section" key={key}>
            <div className="section-heading"><h3>{label}</h3><span className="status-badge">{value ? formatPercent(value.suggestedCommissionRateBps) : "بلا اقتراح"}</span></div>
            {!readOnly ? <label className="field-label" htmlFor={`commission-default-rate-${key}`}>النسبة المقترحة (%)<input id={`commission-default-rate-${key}`} type="number" min="0" max="100" step="0.01" value={rates[key]} onChange={(event) => setRates((current) => ({ ...current, [key]: event.target.value }))} disabled={busyMode !== null} /></label> : null}
            {value ? <p className="muted">آخر تحديث: {formatTimestamp(value.updatedAt)}</p> : <span className="muted">اختياري</span>}
            {value?.changeReason ? <p className="muted">سبب آخر تغيير: {value.changeReason}</p> : null}
            {!readOnly ? <div className="action-row"><button className="button button-primary" type="button" onClick={() => void save(key)} disabled={busyMode !== null || Array.from(reason.trim()).length < 8 || loadedTypeID !== selectedTypeID || rates[key] === ""}>{saveLabel(busyMode === key, value, label)}</button></div> : null}
          </div>;
        })}
      </fieldset>
      {!readOnly ? <label className="field-label" htmlFor="store-type-commission-default-reason">سبب التغيير<TextArea aria-describedby="store-type-commission-default-reason-hint" className="resize-none" id="store-type-commission-default-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} rows={3} disabled={busyMode !== null} placeholder="سبب تعديل النسبة المقترحة" /><small id="store-type-commission-default-reason-hint">٨–٥٠٠ حرف.</small></label> : null}
    </> : null}
    {error ? <p className="validation-error" role="alert">{error}</p> : null}
    {message ? <output className="success">{message}</output> : null}
  </section>;
}
