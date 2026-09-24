"use client";

import { type FieldAdmission, fieldAdmissionStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldRecord = ActorRoleView & Readonly<{ admission: FieldAdmission | null }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldRecord>; nextCursor?: string }>;

export function FieldAdmissionPanel() {
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [items, setItems] = useState<ReadonlyArray<FieldRecord>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [result, setResult] = useState<FieldAdmission | null>(null);
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
      const response = await identityFetch(`/api/fields?${params}`);
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const page = await response.json() as FieldPage;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة سجل الميدانيين.");
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
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admit", contactPhoneE164: phone.replace(/\s+/g, "") }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const body = await response.json() as { admission?: FieldAdmission };
      setResult(body.admission ?? null);
      setNotice("قُبل الميداني وأعيدت قراءة قائمة الميدانيين من Identity وحالة الأهلية من DSH.");
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى خدمة القبول الميداني.");
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(field: FieldRecord) {
    const reason = reasons[field.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير أهلية الميدان.");
      return;
    }
    if (!field.admission || !field.activatedAt) {
      setError("تتطلب إدارة أهلية الميدان تسجيل الهوية ووجود أهلية DSH.");
      return;
    }
    setBusy(field.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: field.enabled && field.admission.state === "eligible" ? "disable" : "activate", actorId: field.actorId, expectedVersion: field.roleVersion, reason }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت نسخة حالة الميداني قبل الحفظ. أُعيد تحميل الحالة الكانونية: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: field.phoneE164 });
      const readbackResponse = await identityFetch(`/api/fields?${readbackParams}`);
      if (!readbackResponse.ok) { setError("تم التغيير لكن تعذرت إعادة قراءة الحالة الكانونية للميداني. أعد القراءة قبل أي إجراء آخر."); return; }
      const readback = await readbackResponse.json() as FieldPage;
      const canonical = readback.items.find((item) => item.actorId === field.actorId);
      if (!canonical) { setError("تم التغيير لكن لم يظهر الميداني في إعادة القراءة الكانونية. أعد القراءة قبل أي إجراء آخر."); return; }
      setReasons((current) => ({ ...current, [field.actorId]: "" }));
      setNotice(`تم تغيير الأهلية وإعادة القراءة: الهوية ${canonical.enabled ? "نشطة" : "موقوفة"} · DSH ${canonical.admission ? fieldAdmissionStateLabel(canonical.admission.state) : "لا توجد أهلية"}.`);
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تحديث أهلية الميداني.");
    } finally {
      setBusy("");
    }
  }

  async function reenroll(field: FieldRecord) {
    const reason = reasons[field.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل إعادة تسجيل الميداني.");
      return;
    }
    if (field.admission?.state !== "eligible" || !field.enabled || field.activatedAt) {
      setError("إعادة التسجيل متاحة للدور المفعّل غير المكتمل تسجيله، بعد إثبات أهلية الميدان في DSH.");
      return;
    }
    setBusy(field.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reenroll", actorId: field.actorId, expectedActorVersion: field.actorVersion, expectedRoleVersion: field.roleVersion, expectedAdmissionVersion: field.admission.version, reason }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت نسخة حالة الميداني قبل إعادة التسجيل. أُعيد تحميل الحالة الكانونية: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: field.phoneE164 });
      const readbackResponse = await identityFetch(`/api/fields?${readbackParams}`);
      if (!readbackResponse.ok) { setError("أُجيزت إعادة التسجيل لكن تعذرت إعادة قراءة حالة الدور. أعد القراءة قبل أي إجراء آخر."); return; }
      const readback = await readbackResponse.json() as FieldPage;
      const canonical = readback.items.find((item) => item.actorId === field.actorId);
      if (!canonical || canonical.activatedAt) { setError("أُجيزت إعادة التسجيل؛ أكمل إجراء التحقق المرسل للميداني ثم أعد القراءة."); return; }
      setReasons((current) => ({ ...current, [field.actorId]: "" }));
      setNotice("تمت إجازة إعادة تسجيل الميداني بعد تحقق DSH من أهليته؛ يلزم الميداني إكمال التحقق لإعادة تنشيط الجلسة.");
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذرت إجازة إعادة تسجيل الميداني.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="access-card" aria-labelledby="field-admission-title">
        <div className="access-card-heading"><span className="step-chip">قبول تشغيلي</span><p className="eyebrow">الممثلون الميدانيون</p><h2 id="field-admission-title">قبول ممثل ميداني</h2><p className="muted">تنشئ DSH أهلية الميدان ثم تثبت Identity الدور المرتبط بها. تبقى الحسابات والصلاحيات الإدارية في مركز الوصول.</p></div>
        <div className="access-form"><label className="field-label" htmlFor="field-phone">هاتف الممثل الميداني<input id="field-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={Boolean(busy)} /></label><button type="button" className="button button-primary" disabled={Boolean(busy) || !phone.trim()} onClick={() => void admit()}>{busy === "admit" ? "جارٍ القبول…" : "قبول الميدان"}</button></div>
        {result ? <div className="managed-status managed-status-info" role="status"><p>أعيدت قراءة حالة القبول: {fieldAdmissionStateLabel(result.state)}.</p></div> : null}
      </section>
      <section className="access-card" aria-labelledby="field-roster-title">
        <div className="access-card-heading"><span className="step-chip">سجل الشركاء</span><h2 id="field-roster-title">قائمة الميدانيين وأهليتهم</h2><p className="muted">تُقرأ الأدوار من Identity والأهلية التشغيلية من DSH. التفعيل والإيقاف وإجازة إعادة التسجيل تتطلب سببًا ونسخًا حديثة.</p></div>
        <div className="workspace-toolbar"><label className="field-label" htmlFor="field-search">بحث برقم الهاتف<input id="field-search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في أرقام الميدانيين" /></label><label className="field-label" htmlFor="field-status-filter">حالة الدور<select id="field-status-filter" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button></div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
        {loading && items.length === 0 ? <p role="status">جارٍ قراءة قائمة الميدانيين…</p> : null}{!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>جرّب إزالة المرشح أو البحث برقم آخر.</p></div> : null}
        {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الهاتف</th><th scope="col">تسجيل الهوية</th><th scope="col">أهلية DSH</th><th scope="col">الإدارة</th></tr></thead><tbody>
          {items.map((field, index) => {
            const operationallyEnabled = field.enabled && field.admission?.state === "eligible";
            const waitingForReenrollment = field.enabled && !field.activatedAt && field.admission?.state === "eligible";
            const reason = reasons[field.actorId] ?? "";
            return <tr key={field.actorId}>
              <th scope="row"><bdi dir="ltr">{field.phoneE164}</bdi></th>
              <td>{!field.securityEnabled ? "الهوية موقوفة أمنيًا" : field.activatedAt ? field.enabled ? "نشط" : "الدور موقوف" : "بانتظار التفعيل"}</td>
              <td>{field.admission ? fieldAdmissionStateLabel(field.admission.state) : "لا توجد أهلية تشغيل في DSH"}</td>
              <td>{field.admission ? <div className="access-form">
                <label className="field-label" htmlFor={`field-reason-${index}`}>سبب الإجراء<input id={`field-reason-${index}`} maxLength={500} value={reason} onChange={(event) => setReasons((current) => ({ ...current, [field.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label>
                {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void reenroll(field)}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
                {field.activatedAt ? <button type="button" className={operationallyEnabled ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void changeStatus(field)}>{busy === field.actorId ? "جارٍ التحديث…" : operationallyEnabled ? "إيقاف التشغيل" : "إعادة التفعيل"}</button> : null}
              </div> : <span className="muted">يبدأ التحكم بعد وجود أهلية DSH.</span>}</td>
            </tr>;
          })}
        </tbody></table></div> : null}
        {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
      </section>
    </>
  );
}
