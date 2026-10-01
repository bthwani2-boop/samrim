"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import { type FieldAdmission, type ServiceCity, type ServiceCityListResponse, fieldAdmissionStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./field-workbench.module.css";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldAccount = ActorRoleView & Readonly<{ admission: FieldAdmission | null }>;
type FieldWorkbenchItem = Readonly<{ kind: "candidate"; admission: FieldAdmission }> | Readonly<{ kind: "account"; account: FieldAccount }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldWorkbenchItem>; nextCursor?: string }>;
type AdmissionMutationResponse = Readonly<{ admission?: FieldAdmission }>;

function fieldRequestError(cause: unknown, fallback: string): string {
  if (isRequestFailure(cause)) return cause.message;
  if (cause instanceof Error) return cause.message;
  return fallback;
}

function identityStatusLabel(field: FieldAccount): string {
  if (!field.securityEnabled) return "الهوية موقوفة أمنيًا";
  if (field.activatedAt && field.enabled) return "نشط";
  if (field.activatedAt) return "الدور موقوف";
  return "بانتظار التفعيل";
}

function admissionStatusLabel(admission: FieldAdmission | null): string {
  if (!admission) return "لا توجد أهلية تشغيل في DSH";
  if (admission.requiresProfileReview) return "الملف يحتاج استكمالًا ومراجعة";
  return fieldAdmissionStateLabel(admission.state);
}

function readbackQuery(query: string, limit = 25): string {
  const params = new URLSearchParams({ scope: "workbench", limit: String(limit), q: query });
  return `/api/fields?${params.toString()}`;
}

export function FieldAdmissionPanel() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ReadonlyArray<FieldWorkbenchItem>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceCityId, setServiceCityId] = useState("");
  const [serviceCities, setServiceCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [serviceCitiesLoading, setServiceCitiesLoading] = useState(true);
  const [serviceCitiesError, setServiceCitiesError] = useState("");
  const [candidateEdits, setCandidateEdits] = useState<Record<string, string>>({});
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadRequestID = useRef(0);

  useEffect(() => {
    let current = true;
    void identityFetch("/api/service-cities", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as ServiceCityListResponse;
      if (current) setServiceCities(result.cities.filter((city) => city.active));
    }).catch((cause: unknown) => {
      if (current) setServiceCitiesError(fieldRequestError(cause, "تعذر تحميل مدن الخدمة النشطة."));
    }).finally(() => { if (current) setServiceCitiesLoading(false); });
    return () => { current = false; };
  }, []);

  const load = useCallback(async (cursor = "", append = false) => {
    const requestID = ++loadRequestID.current;
    if (append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope: "workbench", limit: "25", q: query.trim() });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/fields?${params}`, { cache: "no-store" });
      if (!response.ok) { const message = await responseMessage(response); if (loadRequestID.current === requestID) setError(message); return; }
      const page = await response.json() as FieldPage;
      if (loadRequestID.current !== requestID) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestID.current === requestID) setError(fieldRequestError(cause, "تعذرت قراءة سجل الميدانيين."));
    } finally {
      if (loadRequestID.current === requestID) { setLoading(false); setLoadingMore(false); }
    }
  }, [query]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const syncQuery = () => setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    syncQuery();
    window.addEventListener("popstate", syncQuery);
    return () => window.removeEventListener("popstate", syncQuery);
  }, []);

  function updateQuery(value: string) {
    setQuery(value);
    const params = new URLSearchParams(window.location.search);
    if (value.trim()) params.set("q", value); else params.delete("q");
    params.delete("cursor");
    window.history.replaceState(window.history.state, "", window.location.pathname + (params.size ? `?${params.toString()}` : ""));
  }

  async function readWorkbench(currentQuery: string): Promise<FieldPage> {
    const response = await identityFetch(readbackQuery(currentQuery, 50), { cache: "no-store" });
    if (!response.ok) throw new Error(await responseMessage(response));
    return await response.json() as FieldPage;
  }

  async function createProfile() {
    const name = fullNameAr.trim();
    const contactPhoneE164 = toAsciiDigits(phone).replace(/\s+/g, "");
    const activeCity = serviceCities.find((city) => city.id === serviceCityId && city.active);
    if (Array.from(name).length < 2 || Array.from(name).length > 120 || !/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164) || !activeCity) {
      setError("أدخل الاسم الكامل والهاتف الدولي واختر مدينة خدمة نشطة قبل حفظ الملف.");
      return;
    }
    setBusy("create"); setError(""); setNotice("");
    try {
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admit", fullNameAr: name, contactPhoneE164, serviceCityId: activeCity.id }) });
      if (!response.ok) { setError(await responseMessage(response)); await load(); return; }
      const created = (await response.json() as AdmissionMutationResponse).admission;
      if (!created || created.state !== "pending_review" || created.contactPhoneE164 !== contactPhoneE164 || created.fullNameAr !== name || created.serviceCityId !== activeCity.id) {
        setError("استجاب DSH للحفظ لكن سجل العملية لا يطابق الملف المطلوب. أعد القراءة قبل أي إجراء آخر."); await load(); return;
      }
      const page = await readWorkbench(contactPhoneE164);
      if (!page.items.some((item) => item.kind === "candidate" && item.admission.id === created.id && item.admission.state === "pending_review" && item.admission.fullNameAr === name && item.admission.serviceCityId === activeCity.id)) {
        setError("حُفظ الملف لكن إعادة قراءة السجل الموحّد لا تطابق الملف المنشأ."); await load(); return;
      }
      setFullNameAr(""); setPhone(""); setServiceCityId(""); updateQuery(contactPhoneE164);
      setNotice("أُنشئ الملف وظهر في سجل الميدانيين بانتظار المراجعة.");
      await load();
    } catch (cause) {
      setError(fieldRequestError(cause, "تعذر حفظ ملف الميداني.")); await load();
    } finally { setBusy(""); }
  }

  async function mutateCandidate(admission: FieldAdmission, action: "update-profile" | "approve" | "provision") {
    const nextName = (candidateEdits[admission.id] ?? admission.fullNameAr ?? "").trim();
    if (action === "update-profile" && (Array.from(nextName).length < 2 || Array.from(nextName).length > 120)) { setError("أدخل الاسم الكامل قبل حفظ الملف."); return; }
    setBusy(admission.id); setError(""); setNotice("");
    try {
      const body: { action: typeof action; admissionId: string; fullNameAr?: string; expectedVersion?: number } = { action, admissionId: admission.id };
      if (action === "update-profile") { body.fullNameAr = nextName; body.expectedVersion = admission.version; }
      if (action === "approve") body.expectedVersion = admission.version;
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const message = await responseMessage(response); await load(); setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الملف بالتزامن. ${message}` : message); return; }
      const result = (await response.json() as AdmissionMutationResponse).admission;
      const expectedState = action === "approve" ? "pending_identity" : action === "provision" ? "eligible" : admission.state;
      if (!result || result.id !== admission.id || result.state !== expectedState || (action === "update-profile" && result.fullNameAr !== nextName)) { setError("استجاب DSH لكن حالة الملف المرجعة لا تطابق الخطوة المطلوبة."); await load(); return; }
      const page = await readWorkbench(admission.contactPhoneE164 ?? "");
      if (action === "provision") {
        if (!result.actorId || !page.items.some((item) => item.kind === "account" && item.account.actorId === result.actorId && item.account.admission?.id === admission.id && item.account.admission.state === "eligible")) { setError("مُنح الدور لكن إعادة القراءة لا تثبت ربط حساب Identity بأهلية DSH."); await load(); return; }
      } else if (!page.items.some((item) => item.kind === "candidate" && item.admission.id === admission.id && item.admission.state === expectedState && (action !== "update-profile" || item.admission.fullNameAr === nextName))) {
        setError("نُفذ الإجراء لكن إعادة القراءة لا تثبت حالة الملف المطلوبة."); await load(); return;
      }
      setCandidateEdits((current) => { const next = { ...current }; delete next[admission.id]; return next; });
      setNotice(action === "approve" ? "اعتُمد الملف وأُعيدت قراءته؛ أصبح منح الدور خطوته التالية." : action === "provision" ? "مُنح الدور وأُعيدت قراءة ربط Identity وDSH." : "حُفظ الاسم وأُعيدت قراءة الملف من DSH.");
      await load();
    } catch (cause) { setError(fieldRequestError(cause, "تعذر إكمال الإجراء.")); await load(); }
    finally { setBusy(""); }
  }

  async function mutateAccount(field: FieldAccount, action: "update-profile" | "review-profile" | "activate" | "disable" | "reenroll") {
    const reason = reasons[field.actorId]?.trim() ?? "";
    const admission = field.admission;
    const fullNameAr = (profileEdits[field.actorId] ?? admission?.fullNameAr ?? "").trim();
    const needsReason = action === "activate" || action === "disable" || action === "reenroll";
    if (needsReason && (Array.from(reason).length < 5 || Array.from(reason).length > 500)) { setError("اكتب سببًا من 5 إلى 500 حرف قبل تنفيذ الإجراء."); return; }
    if ((action === "update-profile" || action === "review-profile") && (!admission || admission.state !== "suspended" || !admission.requiresProfileReview)) { setError("هذا الملف لا يحتاج مراجعة حاليًا."); return; }
    if (action === "update-profile" && (Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120)) { setError("أدخل اسم العرض الكامل قبل الحفظ."); return; }
    if (action === "reenroll" && (admission?.state !== "eligible" || !field.enabled || field.activatedAt)) { setError("إعادة التسجيل تتطلب دورًا مفعّلًا وأهلية DSH سارية قبل التفعيل."); return; }
    setBusy(field.actorId); setError(""); setNotice("");
    try {
      const body: Record<string, unknown> = { action, actorId: field.actorId, admissionId: admission?.id, reason };
      if (action === "update-profile" || action === "review-profile") { body.fullNameAr = fullNameAr; body.expectedVersion = admission?.version; }
      if (action === "activate" || action === "disable") body.expectedVersion = field.roleVersion;
      if (action === "reenroll") { body.expectedActorVersion = field.actorVersion; body.expectedRoleVersion = field.roleVersion; body.expectedAdmissionVersion = admission?.version; }
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const message = await responseMessage(response); await load(); setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الحساب بالتزامن. أُعيد تحميل الحالة الحالية؛ راجعها قبل المحاولة مجددًا. ${message}` : message); return; }
      const page = await readWorkbench(field.phoneE164);
      const canonical = page.items.find((item): item is Extract<FieldWorkbenchItem, { kind: "account" }> => item.kind === "account" && item.account.actorId === field.actorId)?.account;
      if (!canonical) { setError("نُفذ الإجراء لكن الحساب لم يظهر في إعادة القراءة الموحّدة."); await load(); return; }
      if ((action === "update-profile" && canonical.admission?.fullNameAr !== fullNameAr) || (action === "review-profile" && canonical.admission?.requiresProfileReview) || (action === "disable" && canonical.enabled) || (action === "activate" && !canonical.enabled) || (action === "reenroll" && canonical.activatedAt)) {
        setError("نُفذ الإجراء لكن إعادة القراءة لا تطابق الحالة المطلوبة."); await load(); return;
      }
      setReasons((current) => ({ ...current, [field.actorId]: "" }));
      setProfileEdits((current) => { const next = { ...current }; delete next[field.actorId]; return next; });
      setNotice("تم الإجراء وأُعيدت قراءة حالة الحساب وأهلية DSH.");
      await load();
    } catch (cause) { setError(fieldRequestError(cause, "تعذر إكمال الإجراء؛ أعد قراءة الحالة.")); await load(); }
    finally { setBusy(""); }
  }

  return <section className={`access-card field-workbench ${styles.root}`} aria-labelledby="field-workbench-title">
    <header className="field-workbench-heading">
      <div><span className="step-chip">مساحة الشركاء</span><h2 id="field-workbench-title">إدارة الميدانيين</h2><p className="muted">قائمة واحدة تجمع ملفات الأهلية والحسابات. DSH يملك الأهلية وIdentity يملك دور الدخول.</p></div>
      <details className="field-create-disclosure"><summary className="button button-primary">إنشاء ملف ميداني</summary><div className="field-create-content"><div className="access-card-heading"><h3>ملف ميداني جديد</h3><p className="muted">يبدأ الملف بالمراجعة؛ إنشاء الملف لا يمنح دور الدخول.</p></div><form className="access-form" onSubmit={(event) => { event.preventDefault(); void createProfile(); }}><label className="field-label" htmlFor="field-candidate-name">الاسم الكامل بالعربية<input id="field-candidate-name" autoComplete="name" maxLength={120} value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} disabled={Boolean(busy)} /></label><label className="field-label" htmlFor="field-candidate-phone">رقم الهاتف<input id="field-candidate-phone" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} disabled={Boolean(busy)} placeholder="+967…" /></label><label className="field-label" htmlFor="field-candidate-city">مدينة الخدمة<select id="field-candidate-city" value={serviceCityId} onChange={(event) => setServiceCityId(event.target.value)} disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError)}><option value="">{serviceCitiesLoading ? "جارٍ تحميل المدن…" : "اختر مدينة نشطة"}</option>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>{serviceCitiesError ? <p className="identity-error" role="alert">{serviceCitiesError}</p> : null}<button type="submit" className="button button-primary" disabled={Boolean(busy) || serviceCitiesLoading || !fullNameAr.trim() || !phone.trim() || !serviceCityId}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ للمراجعة"}</button></form></div></details>
    </header>
    <div className="field-workbench-pane">
      <div className="field-list-heading"><div><h3 id="field-roster-title">سجل الميدانيين</h3><p className="muted">كل شخص يظهر مرة واحدة، مع مرحلته والخطوة التالية.</p></div></div>
      <div className="workspace-toolbar"><label className="field-label" htmlFor="field-search">بحث بالاسم أو الهاتف<input id="field-search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="ابحث في ملفات وحسابات الميدانيين" /></label><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ التحديث…" : "إعادة القراءة"}</button></div>
      {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
      {loading && items.length === 0 ? <p role="status">جارٍ قراءة سجل الميدانيين…</p> : null}
      {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>{query ? "لا توجد نتائج مطابقة" : "لا توجد ملفات أو حسابات ميدانية"}</strong><p>{query ? "امسح البحث لعرض السجل كاملًا." : "أنشئ ملفًا جديدًا لبدء مسار الأهلية."}</p></div> : null}
      {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الميداني</th><th scope="col">مرحلة الملف</th><th scope="col">حساب التطبيق</th><th scope="col">الإجراء</th></tr></thead><tbody>
        {items.map((item) => {
          if (item.kind === "candidate") {
            const profile = item.admission;
            const name = candidateEdits[profile.id] ?? profile.fullNameAr ?? "";
            const changed = name.trim() !== (profile.fullNameAr ?? "");
            return <tr key={`candidate:${profile.id}`}>
              <th scope="row"><strong>{profile.fullNameAr || "ملف بلا اسم مكتمل"}</strong><br /><bdi dir="ltr">{profile.contactPhoneE164 || "—"}</bdi><br /><span className="muted">مدينة الخدمة: {serviceCities.find((city) => city.id === profile.serviceCityId)?.displayNameAr ?? "غير محددة في الملف التاريخي"}</span></th>
              <td>{fieldAdmissionStateLabel(profile.state)}<br /><span className="muted">الإصدار {profile.version}</span></td>
              <td><span className="muted">لم يُنشأ الدور بعد</span></td>
              <td><details className="field-row-disclosure"><summary className="button button-secondary">الخطوة التالية</summary><div className="field-row-actions">{profile.state === "pending_review" ? <><label className="field-label" htmlFor={`candidate-name-${profile.id}`}>اسم العرض<input id={`candidate-name-${profile.id}`} value={name} maxLength={120} disabled={Boolean(busy)} onChange={(event) => setCandidateEdits((current) => ({ ...current, [profile.id]: event.target.value }))} /></label><button type="button" className="button button-secondary" disabled={Boolean(busy) || !changed} onClick={() => void mutateCandidate(profile, "update-profile")}>حفظ الاسم</button><button type="button" className="button button-primary" disabled={Boolean(busy) || changed} onClick={() => void mutateCandidate(profile, "approve")}>{busy === profile.id ? "جارٍ الاعتماد…" : "اعتماد الملف"}</button></> : profile.state === "pending_identity" ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void mutateCandidate(profile, "provision")}>{busy === profile.id ? "جارٍ منح الدور…" : "منح دور الميداني"}</button> : <span className="muted">لا توجد خطوة متاحة لهذه المرحلة.</span>}</div></details></td>
            </tr>;
          }
          const field = item.account;
          const admission = field.admission;
          const requiresProfileReview = admission?.requiresProfileReview === true;
          const mustDisable = requiresProfileReview && admission?.state === "eligible";
          const shouldDisable = field.enabled || mustDisable;
          const waitingForReenrollment = !requiresProfileReview && field.enabled && !field.activatedAt && admission?.state === "eligible";
          const name = profileEdits[field.actorId] ?? admission?.fullNameAr ?? "";
          const reason = reasons[field.actorId] ?? "";
          const legacyReview = requiresProfileReview && admission?.state === "suspended";
          return <tr key={`account:${field.actorId}`}>
            <th scope="row"><strong>{admission?.fullNameAr || "حساب بلا ملف اسم مكتمل"}</strong><br /><bdi dir="ltr">{field.phoneE164}</bdi></th>
            <td>{admissionStatusLabel(admission)}{admission ? <><br /><span className="muted">الإصدار {admission.version}</span></> : null}</td>
            <td>{identityStatusLabel(field)}</td>
            <td>{admission ? <details className="field-row-disclosure"><summary className="button button-secondary">الخطوة التالية</summary><div className="field-row-actions">
              {legacyReview ? <><label className="field-label" htmlFor={`field-profile-name-${field.actorId}`}>استكمال اسم العرض<input id={`field-profile-name-${field.actorId}`} value={name} maxLength={120} disabled={Boolean(busy)} onChange={(event) => setProfileEdits((current) => ({ ...current, [field.actorId]: event.target.value }))} /></label><button type="button" className="button button-secondary" disabled={Boolean(busy) || Array.from(name.trim()).length < 2 || name.trim() === (admission?.fullNameAr ?? "")} onClick={() => void mutateAccount(field, "update-profile")}>حفظ الاسم</button><button type="button" className="button button-primary" disabled={Boolean(busy) || !name.trim() || name.trim() !== (admission?.fullNameAr ?? "")} onClick={() => void mutateAccount(field, "review-profile")}>اعتماد مراجعة الملف</button></> : null}
              <label className="field-label" htmlFor={`field-reason-${field.actorId}`}>سبب الإجراء<input id={`field-reason-${field.actorId}`} maxLength={500} value={reason} onChange={(event) => setReasons((current) => ({ ...current, [field.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label>
              {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void mutateAccount(field, "reenroll")}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
              {(field.activatedAt || shouldDisable) && (shouldDisable || !requiresProfileReview) ? <button type="button" className={shouldDisable ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || Array.from(reason.trim()).length < 5} onClick={() => void mutateAccount(field, shouldDisable ? "disable" : "activate")}>{busy === field.actorId ? "جارٍ التحديث…" : shouldDisable ? "إيقاف الوصول" : "إعادة التفعيل"}</button> : null}
              {requiresProfileReview && !mustDisable && !field.enabled ? <span className="muted">أكمل مراجعة الملف قبل إعادة التفعيل.</span> : null}
              <a className="button button-secondary" href={`/finance/beneficiary-settlement/field?search=${encodeURIComponent(field.actorId)}`}>كشف المحفظة والحركات المالية</a>
            </div></details> : <span className="muted">راجع الأهلية قبل إتاحة العمل الميداني.</span>}</td>
          </tr>;
        })}
      </tbody></table></div> : null}
      {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
    </div>
  </section>;
}
