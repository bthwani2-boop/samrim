"use client";

import type { ServiceCity, ServiceCityListResponse, ServiceCityResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

const arabicCityNamePattern = /^[\p{Script=Arabic}\p{White_Space}\p{Number}\p{Punctuation}]+$/u;

function isArabicCityName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 2 && arabicCityNamePattern.test(normalized) && /\p{Script=Arabic}/u.test(normalized);
}

export function ServiceCityPanel() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [displayNameAr, setDisplayNameAr] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const pendingCreate = useRef<Readonly<{ name: string; active: boolean; idempotencyKey: string }> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/service-cities?includeInactive=true", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      const payload = await response.json() as ServiceCityListResponse;
      if (!Array.isArray(payload.cities)) throw new Error("shape");
      setCities(payload.cities);
    } catch {
      setError("تعذر قراءة المدن.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!canEdit) return;
    const normalizedName = displayNameAr.trim();
    const nameLength = Array.from(normalizedName).length;
    if (nameLength < 2 || nameLength > 160 || !isArabicCityName(normalizedName)) {
      setError("استخدم اسم المدينة باللغة العربية فقط، بين حرفين و160 حرفًا.");
      return;
    }
    if (!pendingCreate.current || pendingCreate.current.name !== normalizedName || pendingCreate.current.active !== active) pendingCreate.current = { name: normalizedName, active, idempotencyKey: crypto.randomUUID() };
    const attempt = pendingCreate.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/service-cities", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey }, body: JSON.stringify({ displayNameAr: normalizedName, active }) });
      if (!response.ok) throw new Error("create");
      await response.json() as ServiceCityResponse;
      pendingCreate.current = null;
      setDisplayNameAr("");
      setNotice("تم حفظ المدينة المعتمدة.");
      await load();
    } catch {
      setError("تعذر حفظ المدينة. تحقق من عدم تكرار الاسم ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(city: ServiceCity) {
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/service-cities/${encodeURIComponent(city.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(city.version) }, body: JSON.stringify({ displayNameAr: city.displayNameAr, active: !city.active }) });
      if (!response.ok) throw new Error("toggle");
      setNotice(`تم ${city.active ? "إيقاف" : "تفعيل"} ${city.displayNameAr}.`);
      await load();
    } catch {
      setError("تعذر تحديث حالة المدينة؛ ربما تغيّرت البيانات قبل الحفظ.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="work-stack" aria-label="إدارة مدن الخدمة">
    {canEdit ? <details className="disclosure create-disclosure"><summary>إضافة مدينة</summary>
      <form className="form-section compact-form" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="field-label" htmlFor="service-city-name">الاسم العربي<input id="service-city-name" maxLength={160} disabled={busy || loading} value={displayNameAr} onChange={(event) => setDisplayNameAr(event.target.value)} /></label>
        <label className="checkbox-field" htmlFor="service-city-active"><input id="service-city-active" type="checkbox" disabled={busy || loading} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشطة عند الإنشاء</label>
        <div className="action-row"><button type="submit" className="button button-primary" disabled={busy || loading}>إضافة مدينة</button></div>
      </form>
    </details> : null}
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void load()}>إعادة المحاولة</button></p> : null}
    {loading ? <p role="status">جارٍ قراءة المدن…</p> : null}
    {!loading && !error && !cities.length ? <p className="collection-state">لا توجد مدن بعد.</p> : null}
    {cities.length > 0 ? <>
      <div className="section-heading"><span className="muted">{cities.length} مدينة{loading || error ? " · آخر قراءة" : ""}</span><button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void load()}>تحديث</button></div>
      <div className="table-wrap" aria-busy={loading}><table className="reference-table"><caption className="visually-hidden">مدن الخدمة</caption>
        <thead><tr><th scope="col">المدينة</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead>
        <tbody>{cities.map((city) => <tr key={city.id}><th scope="row">{city.displayNameAr}</th><td><span className="state-pill">{city.active ? "نشطة" : "متوقفة"}</span></td><td>{canEdit ? <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void toggle(city)}>{city.active ? "تعطيل" : "تفعيل"}</button> : null}</td></tr>)}</tbody>
      </table></div>
    </> : null}
  </section>;
}
