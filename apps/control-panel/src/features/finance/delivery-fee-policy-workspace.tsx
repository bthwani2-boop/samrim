"use client";

import { financialPolicyStateLabel } from "@bthwani/dsh";
import type { DeliveryFeePolicy } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

type City = Readonly<{ id: string; displayNameAr: string; active: boolean }>;
type Policy = Readonly<{ id: string; serviceCityId: string; policyVersion: string; state: DeliveryFeePolicy["state"]; baseFeeMinor: number; distanceUnitMeters: number; distanceRateMinor: number; orderSizeUnitBaseUnits: number; orderSizeRateMinor: number; zoneSurchargeMinor: number; roundingUnitMinor: number; version: number }>;

const emptyForm = { baseFeeMinor: "0", distanceUnitMeters: "1000", distanceRateMinor: "0", orderSizeUnitBaseUnits: "1", orderSizeRateMinor: "0", zoneSurchargeMinor: "0" };

export function DeliveryFeePolicyWorkspace() {
  const [cities, setCities] = useState<City[]>([]);
  const [serviceCityId, setServiceCityId] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const read = useCallback(async (cityId: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/finance/delivery-fee-policy${cityId ? `?serviceCityId=${encodeURIComponent(cityId)}` : ""}`, { cache: "no-store" });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذر قراءة سياسة رسوم التوصيل");
      setPolicy(body.policy);
      setForm({ baseFeeMinor: String(body.policy.baseFeeMinor), distanceUnitMeters: String(body.policy.distanceUnitMeters), distanceRateMinor: String(body.policy.distanceRateMinor), orderSizeUnitBaseUnits: String(body.policy.orderSizeUnitBaseUnits), orderSizeRateMinor: String(body.policy.orderSizeRateMinor), zoneSurchargeMinor: String(body.policy.zoneSurchargeMinor) });
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر قراءة سياسة رسوم التوصيل");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/service-cities", { cache: "no-store" });
      const body = await response.json() as { cities?: City[] };
      const nextCities = body.cities ?? [];
      setCities(nextCities);
      await read("");
    })().catch(() => setError("تعذر قراءة مدن الخدمة"));
  }, [read]);

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = { serviceCityId, baseFeeMinor: Number(form.baseFeeMinor), distanceUnitMeters: Number(form.distanceUnitMeters), distanceRateMinor: Number(form.distanceRateMinor), orderSizeUnitBaseUnits: Number(form.orderSizeUnitBaseUnits), orderSizeRateMinor: Number(form.orderSizeRateMinor), zoneSurchargeMinor: Number(form.zoneSurchargeMinor), roundingUnitMinor: 50 };
      const response = await fetch("/api/finance/delivery-fee-policy", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذر تفعيل سياسة رسوم التوصيل");
      setPolicy(body.policy);
      setMessage("تم تفعيل سياسة رسوم التوصيل بنجاح.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تفعيل سياسة رسوم التوصيل");
    } finally {
      setBusy(false);
    }
  };

  return <section className="access-card" aria-labelledby="delivery-fee-policy-title">
    <div className="finance-toolbar"><div><p className="eyebrow">سياسة مالية مركزية</p><h2 id="delivery-fee-policy-title">رسوم التوصيل</h2></div><button className="button button-secondary" type="button" onClick={() => void read(serviceCityId)} disabled={loading || busy}>تحديث</button></div>
    <p className="muted">تُحسب الرسوم خادميًا من المسافة، ومدينة الخدمة كمنطقة، ووحدات السلة. كل تغيير يُنشئ إصدارًا جديدًا، والتقريب ثابت عند 50 ريال.</p>
    <label className="field-label" htmlFor="delivery-fee-city">المنطقة / مدينة الخدمة<select id="delivery-fee-city" value={serviceCityId} onChange={(event) => { setServiceCityId(event.target.value); void read(event.target.value); }} disabled={busy || loading}><option value="">السياسة العامة</option>{cities.filter((city) => city.active).map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
    {loading ? <p role="status">جارٍ قراءة سياسة رسوم التوصيل…</p> : null}
    {error ? <p className="validation-error" role="alert">{error}</p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
    {policy ? <p className="muted">الحالة: {financialPolicyStateLabel(policy.state)} · التقريب: {policy.roundingUnitMinor} ريال</p> : null}
    <div className="form-grid">
      <label className="field-label" htmlFor="delivery-base">الرسوم الأساسية (ريال)<input id="delivery-base" type="number" min="0" value={form.baseFeeMinor} onChange={(event) => update("baseFeeMinor", event.target.value)} disabled={busy || loading} /></label>
      <label className="field-label" htmlFor="delivery-distance-unit">وحدة المسافة (متر)<input id="delivery-distance-unit" type="number" min="1" value={form.distanceUnitMeters} onChange={(event) => update("distanceUnitMeters", event.target.value)} disabled={busy || loading} /></label>
      <label className="field-label" htmlFor="delivery-distance-rate">رسوم كل وحدة مسافة (ريال)<input id="delivery-distance-rate" type="number" min="0" value={form.distanceRateMinor} onChange={(event) => update("distanceRateMinor", event.target.value)} disabled={busy || loading} /></label>
      <label className="field-label" htmlFor="delivery-size-unit">وحدة حجم الطلب (وحدات)<input id="delivery-size-unit" type="number" min="1" value={form.orderSizeUnitBaseUnits} onChange={(event) => update("orderSizeUnitBaseUnits", event.target.value)} disabled={busy || loading} /></label>
      <label className="field-label" htmlFor="delivery-size-rate">رسوم كل وحدة حجم (ريال)<input id="delivery-size-rate" type="number" min="0" value={form.orderSizeRateMinor} onChange={(event) => update("orderSizeRateMinor", event.target.value)} disabled={busy || loading} /></label>
      <label className="field-label" htmlFor="delivery-zone">بدل المنطقة (ريال)<input id="delivery-zone" type="number" min="0" value={form.zoneSurchargeMinor} onChange={(event) => update("zoneSurchargeMinor", event.target.value)} disabled={busy || loading} /></label>
    </div>
    <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || loading}>{busy ? "جارٍ تفعيل الإصدار…" : "تفعيل إصدار سياسة جديد"}</button>
  </section>;
}
