"use client";

import { type FieldAdmission, fieldAdmissionStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldCandidatePanel } from "./field-candidate-panel";
import styles from "./field-workbench.module.css";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldRecord = ActorRoleView & Readonly<{ admission: FieldAdmission | null }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldRecord>; nextCursor?: string }>;

function identityStatusLabel(field: FieldRecord, requiresProfileReview: boolean): string {
  if (!field.securityEnabled) return "الهوية موقوفة أمنيًا";
  if (requiresProfileReview && field.enabled) return "بانتظار إيقاف الوصول";
  if (requiresProfileReview) return "الوصول موقوف";
  if (field.activatedAt && field.enabled) return "نشط";
  if (field.activatedAt) return "الدور موقوف";
  return "بانتظار التفعيل";
}

function admissionStatusLabel(admission: FieldAdmission | null, requiresProfileReview: boolean): string {
  if (requiresProfileReview) return "الملف يحتاج استكمالًا ومراجعة";
  if (admission) return fieldAdmissionStateLabel(admission.state);
  return "لا توجد أهلية تشغيل في DSH";
}

function statusActionLabel(isBusy: boolean, shouldDisable: boolean): string {
  if (isBusy) return "جارٍ التحديث…";
  if (shouldDisable) return "إيقاف التشغيل";
  return "إعادة التفعيل";
}

export function FieldAdmissionPanel() {
  const [view, setView] = useState<"queue" | "accounts">("queue");
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
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const loadRequestID = useRef(0);

  useEffect(() => {
    const syncView = () => setView(new URLSearchParams(window.location.search).get("view") === "accounts" ? "accounts" : "queue");
    syncView();
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);

  function navigateView(nextView: "queue" | "accounts") {
    const params = new URLSearchParams(window.location.search);
    if (nextView === "accounts") params.set("view", nextView); else params.delete("view");
    window.history.pushState({}, "", window.location.pathname + (params.size ? `?${params.toString()}` : ""));
    setView(nextView);
  }

  const load = useCallback(async (cursor = "", append = false) => {
    const requestID = ++loadRequestID.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25", q: query.trim(), sort });
      if (cursor) params.set("cursor", cursor);
      if (enabledFilter) params.set("enabled", enabledFilter);
      const response = await identityFetch(`/api/fields?${params}`);
      if (!response.ok) { const message = await responseMessage(response); if (loadRequestID.current === requestID) setError(message); return; }
      const page = await response.json() as FieldPage;
      if (loadRequestID.current !== requestID) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestID.current === requestID) setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة سجل الميدانيين.");
    } finally {
      if (loadRequestID.current === requestID) { setLoading(false); setLoadingMore(false); }
    }
  }, [enabledFilter, query, sort]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 250); return () => window.clearTimeout(timer); }, [load]);

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

  async function completeProfileReview(field: FieldRecord, action: "update-profile" | "review-profile") {
    const admission = field.admission;
    const fullNameAr = (profileEdits[field.actorId] ?? admission?.fullNameAr ?? "").trim();
    if (!admission || admission.state !== "suspended" || !admission.requiresProfileReview) {
      setError("يجب إيقاف أهلية الحساب أولًا قبل استكمال الملف ومراجعته.");
      return;
    }
    if (action === "update-profile" && (Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120)) {
      setError("أدخل اسم العرض الكامل قبل حفظ الملف.");
      return;
    }
    if (action === "review-profile" && !fullNameAr) {
      setError("أدخل اسم العرض واحفظه قبل اعتماد المراجعة.");
      return;
    }
    setBusy(field.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, admissionId: admission.id, fullNameAr, expectedVersion: admission.version }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        await load();
        setError(response.status === 409 || response.status === 412 ? `تغير إصدار الملف؛ أُعيدت قراءة الحالة. ${message}` : message);
        return;
      }
      await load();
      setProfileEdits((current) => { const next = { ...current }; delete next[field.actorId]; return next; });
      setNotice(action === "review-profile" ? "اكتملت مراجعة الملف في DSH؛ بقي الدور موقوفًا حتى إعادة تفعيله." : "حُفظ اسم الملف في DSH.");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذرت مراجعة الملف؛ أعد قراءة الحالة قبل إجراء آخر.");
      await load();
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={`access-card field-workbench ${styles.root}`} aria-labelledby="field-workbench-title">
      <header className="field-workbench-heading">
        <div><span className="step-chip">مساحة تشغيل موحّدة</span><h2 id="field-workbench-title">إدارة الميدانيين</h2><p className="muted">ملف DSH يمنح الأهلية؛ حساب Identity يحدد الوصول. كل شخص يظهر في المرحلة التي يملكها حاليًا.</p></div>
        <nav className="field-workbench-tabs" aria-label="مراحل إدارة الميدانيين">
          <button type="button" className="button button-secondary" aria-pressed={view === "queue"} onClick={() => navigateView("queue")}>قائمة الأهلية قبل منح الدور</button>
          <button type="button" className="button button-secondary" aria-pressed={view === "accounts"} onClick={() => navigateView("accounts")}>الحسابات والأهلية التشغيلية</button>
        </nav>
      </header>
      {view === "queue" ? <FieldCandidatePanel /> : <div className="field-workbench-pane">
      <div className="field-list-heading"><div><h3 id="field-roster-title">الحسابات الميدانية</h3><p className="muted">الحسابات من Identity وملف الأهلية المرتبط من DSH. استكمال الملفات القديمة يتم هنا في صف الحساب نفسه.</p></div></div>
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
            const editedName = profileEdits[field.actorId] ?? field.admission?.fullNameAr ?? "";
            const isLegacyReview = requiresProfileReview && field.admission?.state === "suspended";
            return <tr key={field.actorId}>
              <th scope="row"><strong>{field.admission?.fullNameAr || "حساب بلا ملف اسم مكتمل"}</strong><br /><bdi dir="ltr">{field.phoneE164}</bdi>{isLegacyReview ? <label className="field-label field-inline-name" htmlFor={`field-profile-name-${index}`}>استكمال اسم العرض<input id={`field-profile-name-${index}`} value={editedName} maxLength={120} disabled={Boolean(busy)} onChange={(event) => setProfileEdits((current) => ({ ...current, [field.actorId]: event.target.value }))} /></label> : null}</th>
              <td>{identityStatusLabel(field, requiresProfileReview)}</td>
              <td>{admissionStatusLabel(field.admission, requiresProfileReview)}</td>
              <td>{field.admission ? <div className="field-row-actions">
                {isLegacyReview ? <><button type="button" className="button button-secondary" disabled={Boolean(busy) || Array.from(editedName.trim()).length < 2 || editedName.trim() === (field.admission?.fullNameAr ?? "")} onClick={() => void completeProfileReview(field, "update-profile")}>{busy === field.actorId ? "جارٍ الحفظ…" : "حفظ الاسم"}</button><button type="button" className="button button-primary" disabled={Boolean(busy) || !editedName.trim() || editedName.trim() !== (field.admission?.fullNameAr ?? "")} onClick={() => void completeProfileReview(field, "review-profile")}>اعتماد مراجعة الملف</button></> : null}
                <label className="field-label" htmlFor={`field-reason-${index}`}>سبب الإجراء<input id={`field-reason-${index}`} maxLength={500} value={reason} onChange={(event) => setReasons((current) => ({ ...current, [field.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label>
                {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void reenroll(field)}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
                {(field.activatedAt || shouldDisable) && (shouldDisable || !requiresProfileReview) ? <button type="button" className={shouldDisable ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void changeStatus(field)}>{statusActionLabel(busy === field.actorId, shouldDisable)}</button> : null}
                {requiresProfileReview && !mustDisableForProfileReview && !field.enabled ? <span className="muted">استكمل الملف واعتمده قبل إعادة التفعيل.</span> : null}
              </div> : <span className="muted">يبدأ التحكم بعد وجود أهلية DSH.</span>}</td>
            </tr>;
          })}
        </tbody></table></div> : null}
        {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
      </div>}</section>
  );
}
