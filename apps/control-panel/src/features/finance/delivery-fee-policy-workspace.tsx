"use client";

import { financialPolicyStateLabel } from "@bthwani/dsh";
import type { DeliveryFeePolicy } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

type City = Readonly<{ id: string; displayNameAr: string; active: boolean }>;
type Policy = Readonly<{ id: string; serviceCityId: string; policyVersion: string; state: DeliveryFeePolicy["state"]; baseFeeMinor: number; distanceUnitMeters: number; distanceRateMinor: number; orderSizeUnitBaseUnits: number; orderSizeRateMinor: number; zoneSurchargeMinor: number; roundingUnitMinor: number; version: number }>;
type PolicyForm = Readonly<{ baseFeeMinor: string; distanceUnitMeters: string; distanceRateMinor: string; orderSizeUnitBaseUnits: string; orderSizeRateMinor: string; zoneSurchargeMinor: string }>;
type ReadState = "loading" | "ready" | "missing" | "error";

const emptyForm: PolicyForm = { baseFeeMinor: "", distanceUnitMeters: "", distanceRateMinor: "", orderSizeUnitBaseUnits: "", orderSizeRateMinor: "", zoneSurchargeMinor: "" };

function formFromPolicy(policy: Policy): PolicyForm {
  return { baseFeeMinor: String(policy.baseFeeMinor), distanceUnitMeters: String(policy.distanceUnitMeters), distanceRateMinor: String(policy.distanceRateMinor), orderSizeUnitBaseUnits: String(policy.orderSizeUnitBaseUnits), orderSizeRateMinor: String(policy.orderSizeRateMinor), zoneSurchargeMinor: String(policy.zoneSurchargeMinor) };
}

function validForm(form: PolicyForm) {
  const fields = Object.values(form);
  if (fields.some((value) => value.trim() === "" || !Number.isInteger(Number(value)))) return false;
  return Number(form.baseFeeMinor) >= 0 && Number(form.distanceUnitMeters) >= 1 && Number(form.distanceRateMinor) >= 0 && Number(form.orderSizeUnitBaseUnits) >= 1 && Number(form.orderSizeRateMinor) >= 0 && Number(form.zoneSurchargeMinor) >= 0;
}

export function DeliveryFeePolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [cities, setCities] = useState<City[]>([]);
  const [serviceCityId, setServiceCityId] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const [reason, setReason] = useState("");
  const [readState, setReadState] = useState<ReadState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const readSequence = useRef(0);

  const read = useCallback(async (cityId: string): Promise<boolean> => {
    const sequence = ++readSequence.current;
    setReadState("loading");
    setPolicy(null);
    setForm(emptyForm);
    setError("");
    setMessage("");
    try {
      const query = cityId ? `?serviceCityId=${encodeURIComponent(cityId)}` : "";
      const response = await fetch(`/api/finance/delivery-fee-policy${query}`, { cache: "no-store" });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (sequence !== readSequence.current) return false;
      if (response.status === 404) {
        setReadState("missing");
        return false;
      }
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذرت قراءة سياسة هذا النطاق.");
      setPolicy(body.policy);
      setForm(formFromPolicy(body.policy));
      setReadState("ready");
      return true;
    } catch (value) {
      if (sequence === readSequence.current) {
        setReadState("error");
        setError(value instanceof Error ? value.message : "تعذرت قراءة سياسة هذا النطاق.");
      }
      return false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const response = await fetch("/api/service-cities", { cache: "no-store" });
      const body = await response.json() as { cities?: City[] };
      if (!response.ok) throw new Error("تعذرت قراءة مدن الخدمة.");
      if (mounted) setCities(body.cities ?? []);
      await read("");
    })().catch((value: unknown) => {
      if (mounted) {
        setReadState("error");
        setError(value instanceof Error ? value.message : "تعذرت قراءة مدن الخدمة.");
      }
    });
    return () => { mounted = false; readSequence.current += 1; };
  }, [read]);

  const update = (key: keyof PolicyForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if ((readState !== "ready" && readState !== "missing") || !canEdit || !validForm(form) || reason.trim().length < 5 || reason.trim().length > 500) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = { serviceCityId, baseFeeMinor: Number(form.baseFeeMinor), distanceUnitMeters: Number(form.distanceUnitMeters), distanceRateMinor: Number(form.distanceRateMinor), orderSizeUnitBaseUnits: Number(form.orderSizeUnitBaseUnits), orderSizeRateMinor: Number(form.orderSizeRateMinor), zoneSurchargeMinor: Number(form.zoneSurchargeMinor), roundingUnitMinor: 50, expectedVersion: policy?.version ?? 0, reason: reason.trim() };
      const response = await fetch("/api/finance/delivery-fee-policy", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذر تفعيل سياسة رسوم التوصيل.");
      const confirmed = await read(serviceCityId);
      if (!confirmed) throw new Error("تم إرسال التغيير، لكن تعذرت مطابقة القراءة الكانونية بعد الحفظ. حدّث القراءة قبل أي تعديل آخر.");
      setMessage("تم تفعيل السياسة والتحقق من قراءتها من WLT.");
      setReason("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تفعيل سياسة رسوم التوصيل.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="access-card" aria-labelledby="delivery-fee-policy-title">
    <div className="finance-toolbar"><div><p className="eyebrow">مركز السياسات · WLT</p><h2 id="delivery-fee-policy-title">رسوم التوصيل</h2></div><button className="button button-secondary" type="button" onClick={() => void read(serviceCityId)} disabled={busy || readState === "loading"}>إعادة القراءة</button></div>
    <p className="muted">تُحسب الرسوم خادميًا من المسافة، ومدينة الخدمة كمنطقة، ووحدات السلة. كل تعديل يصدر نسخة جديدة، والتقريب ثابت عند 50 ريال.</p>
    <label className="field-label" htmlFor="delivery-fee-city">النطاق / مدينة الخدمة<select id="delivery-fee-city" value={serviceCityId} onChange={(event) => { const next = event.target.value; setServiceCityId(next); void read(next); }} disabled={busy}><option value="">السياسة العامة</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}{city.active ? "" : " · غير نشطة"}</option>)}</select></label>
    {readState === "loading" ? <p role="status">جارٍ قراءة WLT لهذا النطاق…</p> : null}
    {readState === "missing" ? <p className="managed-status managed-status-warning" role="status">لا توجد سياسة نشطة لهذا النطاق. املأ القيم صراحةً لإنشاء أول إصدار.</p> : null}
    {readState === "error" ? <p className="validation-error" role="alert">{error || "تعذرت القراءة؛ الحفظ معطل حتى نجاح القراءة."}</p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
    {policy ? <p className="muted">الحالة: {financialPolicyStateLabel(policy.state)} · الإصدار: {policy.version} · التقريب: {policy.roundingUnitMinor} ريال</p> : null}
    {(readState === "ready" || readState === "missing") ? <>
      <div className="form-grid">
        <label className="field-label" htmlFor="delivery-base">الرسوم الأساسية (ريال)<input id="delivery-base" type="number" min="0" value={form.baseFeeMinor} onChange={(event) => update("baseFeeMinor", event.target.value)} disabled={busy || !canEdit} /></label>
        <label className="field-label" htmlFor="delivery-distance-unit">وحدة المسافة (متر)<input id="delivery-distance-unit" type="number" min="1" value={form.distanceUnitMeters} onChange={(event) => update("distanceUnitMeters", event.target.value)} disabled={busy || !canEdit} /></label>
        <label className="field-label" htmlFor="delivery-distance-rate">رسوم كل وحدة مسافة (ريال)<input id="delivery-distance-rate" type="number" min="0" value={form.distanceRateMinor} onChange={(event) => update("distanceRateMinor", event.target.value)} disabled={busy || !canEdit} /></label>
        <label className="field-label" htmlFor="delivery-size-unit">وحدة حجم الطلب (وحدات)<input id="delivery-size-unit" type="number" min="1" value={form.orderSizeUnitBaseUnits} onChange={(event) => update("orderSizeUnitBaseUnits", event.target.value)} disabled={busy || !canEdit} /></label>
        <label className="field-label" htmlFor="delivery-size-rate">رسوم كل وحدة حجم (ريال)<input id="delivery-size-rate" type="number" min="0" value={form.orderSizeRateMinor} onChange={(event) => update("orderSizeRateMinor", event.target.value)} disabled={busy || !canEdit} /></label>
        <label className="field-label" htmlFor="delivery-zone">بدل المنطقة (ريال)<input id="delivery-zone" type="number" min="0" value={form.zoneSurchargeMinor} onChange={(event) => update("zoneSurchargeMinor", event.target.value)} disabled={busy || !canEdit} /></label>
      </div>
      <label className="field-label" htmlFor="delivery-policy-reason">سبب التغيير<textarea id="delivery-policy-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} disabled={busy || !canEdit} /></label>
      {error ? <p className="validation-error" role="alert">{error}</p> : null}
      <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || !canEdit || !validForm(form) || reason.trim().length < 5 || reason.trim().length > 500}>{busy ? "جارٍ التفعيل والتحقق…" : policy ? "تفعيل نسخة معدلة" : "إنشاء السياسة الأولى"}</button>
    </> : null}
  </section>;
}
