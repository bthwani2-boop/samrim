"use client";

import type { ServiceCity, ServiceCityListResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

export function ServiceCityPanel() {
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [cityId, setCityId] = useState("");
  const [displayNameAr, setDisplayNameAr] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/service-cities?includeInactive=true", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      setCities((await response.json() as ServiceCityListResponse).cities);
    } catch {
      setError("تعذر قراءة المدن من DSH.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const normalizedId = cityId.trim();
    const normalizedName = displayNameAr.trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(normalizedId) || normalizedName.length < 2 || normalizedName.length > 160) {
      setError("استخدم معرفًا لاتينيًا ثابتًا واسمًا عربيًا بين حرفين و160 حرفًا.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/service-cities", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ id: normalizedId, displayNameAr: normalizedName, active }) });
      if (!response.ok) throw new Error("create");
      setCityId("");
      setDisplayNameAr("");
      setNotice("تم حفظ المدينة الكانونية.");
      await load();
    } catch {
      setError("تعذر حفظ المدينة. تحقق من عدم تكرار المعرف أو الاسم ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(city: ServiceCity) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/service-cities/${encodeURIComponent(city.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(city.version) }, body: JSON.stringify({ displayNameAr: city.displayNameAr, active: !city.active }) });
      if (!response.ok) throw new Error("toggle");
      setNotice(`تم ${city.active ? "إيقاف" : "تفعيل"} ${city.displayNameAr}.`);
      await load();
    } catch {
      setError("تعذر تحديث حالة المدينة؛ قد تكون النسخة قديمة.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="access-card" aria-labelledby="service-city-title"><div className="access-card-heading"><span className="step-chip">CITY · DSH</span><p className="eyebrow">نطاقات الخدمة</p><h2 id="service-city-title">إدارة المدن الكانونية</h2><p className="muted">المدينة يملكها DSH وتحدد نطاق اكتشاف العميل وأهلية المتجر. لا توجد مدينة افتراضية أو تخمين من الإحداثيات.</p></div><div className="access-form"><label className="field-label" htmlFor="service-city-id">المعرف الثابت<input id="service-city-id" disabled={busy} value={cityId} onChange={(event) => setCityId(event.target.value)} placeholder="sanaa" /></label><label className="field-label" htmlFor="service-city-name">الاسم العربي<input id="service-city-name" disabled={busy} value={displayNameAr} onChange={(event) => setDisplayNameAr(event.target.value)} placeholder="صنعاء" /></label><label className="field-label" htmlFor="service-city-active"><input id="service-city-active" type="checkbox" disabled={busy} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشطة عند الإنشاء</label><button type="button" className="button button-primary" disabled={busy} onClick={() => void create()}>إضافة مدينة</button></div>{notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void load()}>إعادة المحاولة</button></p> : null}<div className="managed-status managed-status-info"><strong>السجل الكانوني</strong>{cities.length === 0 ? <p>لا توجد مدن بعد.</p> : <ul>{cities.map((city) => <li key={city.id}><span>{city.displayNameAr} · <code>{city.id}</code> · الإصدار {city.version} · {city.active ? "نشطة" : "متوقفة"}</span> <button type="button" className="button button-secondary" disabled={busy} onClick={() => void toggle(city)}>{city.active ? "تعطيل" : "تفعيل"}</button></li>)}</ul>}</div></section>;
}
