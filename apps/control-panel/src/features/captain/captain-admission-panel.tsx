"use client";

import { type CaptainAdmission, captainAdmissionStateLabel, captainAvailabilityStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type CaptainRecord = ActorRoleView & Readonly<{ admission: CaptainAdmission | null }>;
type CaptainPage = Readonly<{ items: ReadonlyArray<CaptainRecord>; nextCursor?: string }>;

const admissionLabel = (admission: CaptainAdmission | null) => admission ? captainAdmissionStateLabel(admission.state) : "لا توجد أهلية تشغيل في DSH";

export function CaptainAdmissionPanel() {
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [items, setItems] = useState<ReadonlyArray<CaptainRecord>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [result, setResult] = useState<CaptainAdmission | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25", q: query.trim() });
      if (cursor) params.set("cursor", cursor);
      if (enabledFilter) params.set("enabled", enabledFilter);
      const response = await identityFetch(`/api/captains?${params}`);
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const page = await response.json() as CaptainPage;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة سجل الكباتن.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [enabledFilter, query]);

  useEffect(() => { void load(); }, [load]);

  async function admit() {
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone.replace(/\s+/g, ""))) {
      setError("أدخل رقم هاتف بصيغة E.164 مثل +96777000100.");
      return;
    }
    setBusy("admit");
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admit", phone: phone.replace(/\s+/g, "") }),
      });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const body = await response.json() as { admission?: CaptainAdmission };
      setResult(body.admission ?? null);
      setNotice("قُبل الكابتن وأعيدت قراءة قائمة الكباتن من Identity وحالة الأهلية من DSH.");
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى خدمة قبول الكباتن.");
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(captain: CaptainRecord) {
    const reason = reasons[captain.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير أهلية التشغيل.");
      return;
    }
    if (!captain.admission || !captain.activatedAt) {
      setError("تتطلب إدارة أهلية التشغيل تسجيل الهوية ووجود أهلية كابتن في DSH.");
      return;
    }
    const operationallyEnabled = captain.enabled && captain.admission?.state === "eligible";
    const action = operationallyEnabled ? "disable" : "activate";
    setBusy(captain.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorId: captain.actorId, expectedVersion: captain.roleVersion, reason }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت نسخة حالة أهلية الكابتن قبل الحفظ. أُعيد تحميل الحالة الكانونية: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: captain.phoneE164 });
      const readbackResponse = await identityFetch(`/api/captains?${readbackParams}`);
      if (!readbackResponse.ok) { setError("تم التغيير لكن تعذرت إعادة قراءة الحالة الكانونية للكابتن. أعد القراءة قبل أي إجراء آخر."); return; }
      const readback = await readbackResponse.json() as CaptainPage;
      const canonical = readback.items.find((item) => item.actorId === captain.actorId);
      if (!canonical) { setError("تم التغيير لكن لم يظهر الكابتن في إعادة القراءة الكانونية. أعد القراءة قبل أي إجراء آخر."); return; }
      setReasons((current) => ({ ...current, [captain.actorId]: "" }));
      setNotice(`تم تغيير الأهلية وإعادة القراءة: الهوية ${canonical.enabled ? "نشطة" : "موقوفة"} · DSH ${admissionLabel(canonical.admission)}.`);
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تحديث أهلية الكابتن.");
    } finally {
      setBusy("");
    }
  }

  async function changeAvailability(captain: CaptainRecord) {
    const reason = reasons[captain.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير توفر الكابتن.");
      return;
    }
    if (!captain.enabled || !captain.securityEnabled || !captain.activatedAt || !captain.admission || captain.admission.state !== "eligible") {
      setError("يتطلب تغيير التوفر هوية نشطة وأهلية تشغيل فعالة في DSH.");
      return;
    }
    const available = captain.admission.availabilityState !== "available";
    setBusy(`${captain.actorId}:availability`);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "availability", actorId: captain.actorId, available, expectedVersion: captain.admission.version, reason }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت نسخة حالة توفر الكابتن قبل الحفظ. أُعيد تحميل الحالة الكانونية: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: captain.phoneE164 });
      const readbackResponse = await identityFetch(`/api/captains?${readbackParams}`);
      if (!readbackResponse.ok) { setError("تم الطلب لكن تعذرت إعادة قراءة حالة التوفر من DSH. أعد القراءة قبل أي إجراء آخر."); return; }
      const readback = await readbackResponse.json() as CaptainPage;
      const canonical = readback.items.find((item) => item.actorId === captain.actorId);
      if (!canonical?.admission) { setError("تم الطلب لكن لم تظهر أهلية الكابتن في إعادة القراءة. أعد القراءة قبل أي إجراء آخر."); return; }
      setReasons((current) => ({ ...current, [captain.actorId]: "" }));
      setNotice(`أُعيدت قراءة التوفر من DSH: ${captainAvailabilityStateLabel(canonical.admission.availabilityState)} · الإصدار ${canonical.admission.version}.`);
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تحديث توفر الكابتن.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="access-card" aria-labelledby="captain-admission-title">
        <div className="access-card-heading">
          <span className="step-chip">الكباتن · الأهلية العامة</span>
          <p className="eyebrow">قبول منظم</p>
          <h2 id="captain-admission-title">قبول كابتن في منصة التشغيل</h2>
          <p className="muted">يُنشأ دور الكابتن في Identity وتُسجل أهليته في DSH. عضوية الكابتن لدى متجر شريك علاقة مستقلة يديرها الشريك.</p>
        </div>
        <div className="access-form admission-form">
          <label className="field-label" htmlFor="captain-admission-phone">هاتف الكابتن المراد قبوله<input id="captain-admission-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={Boolean(busy)} /></label>
          <button type="button" className="button button-primary" onClick={() => void admit()} disabled={Boolean(busy) || !phone.trim()}>{busy === "admit" ? "جارٍ القبول…" : "قبول الكابتن"}</button>
        </div>
        {result ? <div className="managed-status managed-status-info" role="status"><strong>أُعيدت قراءة أهلية الكابتن</strong><p>الحالة: {captainAdmissionStateLabel(result.state)} · التوفر: {captainAvailabilityStateLabel(result.availabilityState)}</p></div> : null}
      </section>
      <section className="access-card" aria-labelledby="captain-roster-title">
        <div className="access-card-heading"><span className="step-chip">سجل العمليات</span><h2 id="captain-roster-title">قائمة الكباتن وأهليتهم وتوفرهم</h2><p className="muted">بيانات الدور تُقرأ من Identity، وحالة الأهلية والتوفر من DSH. إدارة التوفر تسجّل السبب والمنفّذ والإصدار في سجل DSH، وإيقاف الأهلية التشغيلية لا يغيّر هوية الكابتن.</p></div>
        <div className="workspace-toolbar">
          <label className="field-label" htmlFor="captain-search">بحث برقم الهاتف<input id="captain-search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في أرقام الكباتن" /></label>
          <label className="field-label" htmlFor="captain-status-filter">حالة الدور<select id="captain-status-filter" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label>
          <button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
        </div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}
        {error ? <p className="identity-error" role="alert">{error}</p> : null}
        {loading && items.length === 0 ? <p role="status">جارٍ قراءة قائمة الكباتن…</p> : null}
        {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>جرّب إزالة المرشح أو البحث برقم آخر.</p></div> : null}
        {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الهاتف</th><th scope="col">تسجيل الهوية</th><th scope="col">أهلية DSH</th><th scope="col">التوفر</th><th scope="col">إدارة الأهلية</th></tr></thead><tbody>
          {items.map((captain, index) => {
            const operationallyEnabled = captain.enabled && captain.admission?.state === "eligible";
            const canChangeAvailability = operationallyEnabled && captain.securityEnabled && Boolean(captain.activatedAt);
            return <tr key={captain.actorId}>
            <th scope="row"><bdi dir="ltr">{captain.phoneE164}</bdi></th>
            <td>{!captain.securityEnabled ? "الهوية موقوفة أمنيًا" : captain.activatedAt ? captain.enabled ? "نشط" : "الدور موقوف" : "بانتظار التفعيل"}</td>
            <td>{admissionLabel(captain.admission)}</td>
            <td>{captain.admission ? captainAvailabilityStateLabel(captain.admission.availabilityState) : "—"}</td>
            <td>{captain.admission && captain.activatedAt ? <div className="access-form">
              <label className="field-label" htmlFor={`captain-reason-${index}`}>سبب الإجراء<input id={`captain-reason-${index}`} maxLength={500} value={reasons[captain.actorId] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [captain.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label>
              <button type="button" className={operationallyEnabled ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || (reasons[captain.actorId] ?? "").trim().length < 5} onClick={() => void changeStatus(captain)}>{busy === captain.actorId ? "جارٍ التحديث…" : operationallyEnabled ? "إيقاف التشغيل" : "إعادة التفعيل"}</button>
              <button type="button" className="button button-secondary" disabled={Boolean(busy) || !canChangeAvailability || (reasons[captain.actorId] ?? "").trim().length < 5} onClick={() => void changeAvailability(captain)}>{busy === `${captain.actorId}:availability` ? "جارٍ التحديث…" : captain.admission.availabilityState === "available" ? "جعله غير متاح" : "جعله متاحًا"}</button>
            </div> : <span className="muted">يبدأ التحكم بعد اكتمال التسجيل ووجود أهلية DSH.</span>}</td>
          </tr>;
          })}
        </tbody></table></div> : null}
        {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
      </section>
    </>
  );
}
