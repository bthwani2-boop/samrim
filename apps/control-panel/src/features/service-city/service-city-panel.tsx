"use client";

import type { ServiceCity, ServiceCityListResponse, ServiceCityResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

const arabicCityNamePattern = /^[\p{Script=Arabic}\p{White_Space}\p{Number}\p{Punctuation}]+$/u;

function isArabicCityName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 2 && arabicCityNamePattern.test(normalized) && /\p{Script=Arabic}/u.test(normalized);
}

export function ServiceCityPanel() {
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
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
      setError("تعذر قراءة المدن.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const normalizedName = displayNameAr.trim();
    const nameLength = Array.from(normalizedName).length;
    if (nameLength < 2 || nameLength > 160 || !isArabicCityName(normalizedName)) {
      setError("استخدم اسم المدينة باللغة العربية فقط، بين حرفين و160 حرفًا.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/service-cities", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ displayNameAr: normalizedName, active }) });
      if (!response.ok) throw new Error("create");
      const result = await response.json() as ServiceCityResponse;
      setDisplayNameAr("");
      setNotice("تم حفظ المدينة الكانونية.");
      await load();
    } catch {
      setError("تعذر حفظ المدينة. تحقق من عدم تكرار الاسم ثم أعد المحاولة.");
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

  return <section className="access-card" aria-labelledby="service-city-title"><div className="access-card-heading"><span className="step-chip">إدارة المدن</span><p className="eyebrow">نطاقات الخدمة</p><h2 id="service-city-title">إدارة المدن الكانونية</h2><p className="muted">تحدد المدينة نطاق اكتشاف العميل وأهلية المتجر. لا توجد مدينة افتراضية أو تخمين من الإحداثيات.</p></div><div className="access-form"><label className="field-label" htmlFor="service-city-name">الاسم العربي<input id="service-city-name" disabled={busy} value={displayNameAr} onChange={(event) => setDisplayNameAr(event.target.value)} placeholder="صنعاء" /></label><p className="muted">يولّد DSH السجل الداخلي تلقائيًا ويثبته بعد الإنشاء.</p><label className="field-label" htmlFor="service-city-active"><input id="service-city-active" type="checkbox" disabled={busy} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشطة عند الإنشاء</label><button type="button" className="button button-primary" disabled={busy} onClick={() => void create()}>إضافة مدينة</button></div>{notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void load()}>إعادة المحاولة</button></p> : null}<div className="managed-status managed-status-info"><strong>السجل الكانوني</strong>{cities.length === 0 ? <p>لا توجد مدن بعد.</p> : <ul>{cities.map((city) => <li key={city.id}><span>{city.displayNameAr} · {city.active ? "نشطة" : "متوقفة"}</span> <button type="button" className="button button-secondary" disabled={busy} onClick={() => void toggle(city)}>{city.active ? "تعطيل" : "تفعيل"}</button></li>)}</ul>}</div></section>;
}
