"use client";

import { type FieldAdmission, fieldAdmissionStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useState } from "react";
import { FieldCandidatePanel } from "./field-candidate-panel";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldRecord = ActorRoleView & Readonly<{ admission: FieldAdmission | null }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldRecord>; nextCursor?: string }>;

export function FieldAdmissionPanel() {
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [sort, setSort] = useState<"phone_asc" | "phone_desc">("phone_asc");
  const [items, setItems] = useState<ReadonlyArray<FieldRecord>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25", q: query.trim(), sort });
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
  }, [enabledFilter, query, sort]);

  useEffect(() => { void load(); }, [load]);

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
    const mustDisable = field.enabled || (field.admission.requiresProfileReview && field.admission.state === "eligible");
    if (!mustDisable && field.admission.requiresProfileReview) {
      setError("ملف الميداني معلّق حتى استكماله ومراجعته؛ لا يمكن إعادة تفعيل الدور الآن.");
      return;
    }
    setBusy(field.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mustDisable ? "disable" : "activate", actorId: field.actorId, expectedVersion: field.roleVersion, reason }),
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
      <FieldCandidatePanel />
      <section className="access-card" aria-labelledby="field-roster-title">
        <div className="access-card-heading"><span className="step-chip">سجل الشركاء</span><h2 id="field-roster-title">قائمة الميدانيين وأهليتهم</h2><p className="muted">تُقرأ الأدوار من Identity والأهلية التشغيلية من DSH. التفعيل والإيقاف وإجازة إعادة التسجيل تتطلب سببًا ونسخًا حديثة.</p></div>
        <div className="workspace-toolbar"><label className="field-label" htmlFor="field-search">بحث برقم الهاتف<input id="field-search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في أرقام الميدانيين" /></label><label className="field-label" htmlFor="field-status-filter">حالة الدور<select id="field-status-filter" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label><label className="field-label" htmlFor="field-sort">ترتيب رقم الهاتف<select id="field-sort" value={sort} onChange={(event) => setSort(event.target.value as "phone_asc" | "phone_desc")}><option value="phone_asc">تصاعدي</option><option value="phone_desc">تنازلي</option></select></label><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button></div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
        {loading && items.length === 0 ? <p role="status">جارٍ قراءة قائمة الميدانيين…</p> : null}{!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>جرّب إزالة المرشح أو البحث برقم آخر.</p></div> : null}
        {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الاسم والهاتف</th><th scope="col">تسجيل الهوية</th><th scope="col">أهلية DSH</th><th scope="col">الإدارة</th></tr></thead><tbody>
          {items.map((field, index) => {
            const requiresProfileReview = field.admission?.requiresProfileReview === true;
            const mustDisableForProfileReview = requiresProfileReview && field.admission?.state === "eligible";
            const shouldDisable = field.enabled || mustDisableForProfileReview;
            const waitingForReenrollment = !requiresProfileReview && field.enabled && !field.activatedAt && field.admission?.state === "eligible";
            const reason = reasons[field.actorId] ?? "";
            return <tr key={field.actorId}>
              <th scope="row"><strong>{field.admission?.fullNameAr || "—"}</strong><br /><bdi dir="ltr">{field.phoneE164}</bdi></th>
              <td>{!field.securityEnabled ? "الهوية موقوفة أمنيًا" : requiresProfileReview && field.enabled ? "بانتظار إيقاف الوصول" : requiresProfileReview ? "الوصول موقوف" : field.activatedAt ? field.enabled ? "نشط" : "الدور موقوف" : "بانتظار التفعيل"}</td>
              <td>{requiresProfileReview ? "الملف يحتاج استكمالًا ومراجعة" : field.admission ? fieldAdmissionStateLabel(field.admission.state) : "لا توجد أهلية تشغيل في DSH"}</td>
              <td>{field.admission ? <div className="access-form">
                <label className="field-label" htmlFor={`field-reason-${index}`}>سبب الإجراء<input id={`field-reason-${index}`} maxLength={500} value={reason} onChange={(event) => setReasons((current) => ({ ...current, [field.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label>
                {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void reenroll(field)}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
                {field.activatedAt && (shouldDisable || !requiresProfileReview) ? <button type="button" className={shouldDisable ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void changeStatus(field)}>{busy === field.actorId ? "جارٍ التحديث…" : shouldDisable ? "إيقاف التشغيل" : "إعادة التفعيل"}</button> : null}
                {requiresProfileReview && !mustDisableForProfileReview && !field.enabled ? <span className="muted">استكمل الملف واعتمده قبل إعادة التفعيل.</span> : null}
              </div> : <span className="muted">يبدأ التحكم بعد وجود أهلية DSH.</span>}</td>
            </tr>;
          })}
        </tbody></table></div> : null}
        {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
      </section>
    </>
  );
}
