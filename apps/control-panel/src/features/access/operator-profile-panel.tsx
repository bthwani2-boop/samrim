"use client";

import { normalizeYemenPhoneE164, toAsciiDigits } from "@bthwani/design-system";
import type { OperatorProfile, OperatorProfileInvitationResponse, OperatorProfilePage } from "@bthwani/identity";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "./identity-error-message";

type ProfileEdit = Readonly<{ fullNameAr: string; phoneE164: string; jobTitle: string; department: string }>;
type ProfileState = "all" | "pending_review" | "approved" | "admitted";
type ProfileSort = "created_asc" | "created_desc";

function stateLabel(profile: OperatorProfile): string {
  if (profile.state === "pending_review") return "بانتظار المراجعة";
  if (profile.state === "approved") return "معتمد لمنح الدور";
  if (!profile.roleEnabled) return "الدور موقوف";
  if (!profile.securityEnabled) return "الهوية موقوفة";
  if (!profile.activatedAt) return "بانتظار التفعيل";
  return "نشط";
}

function stateTone(profile: OperatorProfile): string {
  if (profile.state === "pending_review" || profile.state === "approved") return "is-waiting";
  if (!profile.roleEnabled || !profile.securityEnabled) return "is-paused";
  if (!profile.activatedAt) return "is-waiting";
  return "is-active";
}

function mutationSuccessLabel(action: "update-profile" | "approve" | "grant" | "invitation"): string {
  if (action === "approve") return "اعتُمد الملف. الخطوة التالية منح الدور.";
  if (action === "grant") return "مُنح دور المشغّل. أصدر دعوة التفعيل عند الجاهزية.";
  return "تم تحديث الملف.";
}

function profileDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium" }).format(date);
}

export function OperatorProfilePanel() {
  const [fullNameAr, setFullNameAr] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [createNameInvalid, setCreateNameInvalid] = useState(false);
  const [createPhoneInvalid, setCreatePhoneInvalid] = useState(false);
  const [createJobTitleInvalid, setCreateJobTitleInvalid] = useState(false);
  const [createDepartmentInvalid, setCreateDepartmentInvalid] = useState(false);
  const [createValidationError, setCreateValidationError] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [state, setState] = useState<ProfileState>("all");
  const [sort, setSort] = useState<ProfileSort>("created_desc");
  const [items, setItems] = useState<ReadonlyArray<OperatorProfile>>([]);
  const [edits, setEdits] = useState<Record<string, ProfileEdit>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitation, setInvitation] = useState<OperatorProfileInvitationResponse | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const loadRequestId = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const createDisclosure = useRef<HTMLDetailsElement>(null);
  const createNameInput = useRef<HTMLInputElement>(null);
  const createPhoneInput = useRef<HTMLInputElement>(null);
  const createJobTitleInput = useRef<HTMLInputElement>(null);
  const createDepartmentInput = useRef<HTMLInputElement>(null);

  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get("profileState");
    const requestedSort = params.get("profileSort");
    setState(requestedState === "pending_review" || requestedState === "approved" || requestedState === "admitted" ? requestedState : "all");
    setSort(requestedSort === "created_asc" ? "created_asc" : "created_desc");
    setItems([]);
    setNextCursor("");
  }, []);

  useEffect(() => {
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  const navigate = useCallback((nextState: ProfileState, nextSort: ProfileSort) => {
    const params = new URLSearchParams(window.location.search);
    if (nextState !== "all") params.set("profileState", nextState); else params.delete("profileState");
    if (nextSort !== "created_desc") params.set("profileSort", nextSort); else params.delete("profileSort");
    const search = params.toString();
    window.history.pushState(window.history.state, "", window.location.pathname + (search ? `?${search}` : ""));
    setState(nextState);
    setSort(nextSort);
    setItems([]);
    setNextCursor("");
    setError("");
  }, []);

  const load = useCallback(async (cursor = "", append = false) => {
    const requestId = ++loadRequestId.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: appliedQuery, state, sort, limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/access/operator-profiles?${params.toString()}`);
      if (loadRequestId.current !== requestId) return;
      if (!response.ok) throw new Error(await responseMessage(response));
      const page = await response.json() as OperatorProfilePage;
      if (loadRequestId.current !== requestId) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestId.current !== requestId) return;
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة ملفات المشغّلين.");
      if (!append) setItems([]);
      setNextCursor("");
    } finally {
      if (loadRequestId.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [appliedQuery, sort, state]);

  useEffect(() => { if (urlReady) void load(); }, [load, urlReady]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Name and phone searches stay out of the URL and browser history because they contain personal data.
    const nextQuery = query.trim().slice(0, 100);
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setItems([]);
    setNextCursor("");
    setError("");
  }

  function clearSearch() {
    setQuery("");
    setAppliedQuery("");
    setItems([]);
    setNextCursor("");
    setError("");
    searchInput.current?.focus();
  }

  function clearFilters() {
    navigate("all", "created_desc");
    setQuery("");
    setAppliedQuery("");
    searchInput.current?.focus();
  }

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fullNameAr.trim();
    const phone = normalizeYemenPhoneE164(phoneE164);
    const title = jobTitle.trim();
    const unit = department.trim();
    const nameValid = Array.from(name).length >= 2 && Array.from(name).length <= 120;
    const phoneValid = /^\+[1-9][0-9]{7,14}$/.test(phone);
    const titleValid = Array.from(title).length >= 1 && Array.from(title).length <= 80;
    const departmentValid = Array.from(unit).length >= 1 && Array.from(unit).length <= 80;
    setCreateNameInvalid(!nameValid);
    setCreatePhoneInvalid(!phoneValid);
    setCreateJobTitleInvalid(!titleValid);
    setCreateDepartmentInvalid(!departmentValid);
    if (!nameValid || !phoneValid || !titleValid || !departmentValid) {
      setError("");
      setCreateValidationError(!nameValid ? "أدخل الاسم بالعربية (حرفان على الأقل)." : !phoneValid ? "أدخل رقم هاتف يمنيًا صحيحًا." : !titleValid ? "أدخل المسمى الوظيفي (حتى 80 حرفًا)." : "أدخل القسم (حتى 80 حرفًا).");
      if (!nameValid) createNameInput.current?.focus();
      else if (!phoneValid) createPhoneInput.current?.focus();
      else if (!titleValid) createJobTitleInput.current?.focus();
      else createDepartmentInput.current?.focus();
      return;
    }
    setCreateValidationError("");
    setBusy("create");
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const response = await identityFetch("/api/access/operator-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullNameAr: name, phoneE164: phone, jobTitle: title, department: unit }),
      });
      if (!response.ok) { setError(await responseMessage(response)); await load(); return; }
      setFullNameAr("");
      setPhoneE164("");
      setJobTitle("");
      setDepartment("");
      setCreateNameInvalid(false);
      setCreatePhoneInvalid(false);
      setCreateJobTitleInvalid(false);
      setCreateDepartmentInvalid(false);
      setCreateValidationError("");
      if (createDisclosure.current) createDisclosure.current.open = false;
      setNotice("أُنشئ الملف وبات بانتظار المراجعة.");
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر حفظ ملف المشغّل.");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function updateProfile(profile: OperatorProfile) {
    const edit = edits[profile.id] ?? { fullNameAr: profile.fullNameAr, phoneE164: profile.phoneE164 ?? "", jobTitle: profile.jobTitle ?? "", department: profile.department ?? "" };
    const phone = normalizeYemenPhoneE164(edit.phoneE164);
    if (Array.from(edit.fullNameAr.trim()).length < 2 || Array.from(edit.jobTitle.trim()).length < 1 || Array.from(edit.jobTitle.trim()).length > 80 || Array.from(edit.department.trim()).length < 1 || Array.from(edit.department.trim()).length > 80 || !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError("تحقق من الاسم ورقم الهاتف والمسمى والقسم قبل الحفظ.");
      return;
    }
    await mutate(profile, "update-profile", { fullNameAr: edit.fullNameAr.trim(), phoneE164: phone, jobTitle: edit.jobTitle.trim(), department: edit.department.trim(), expectedVersion: profile.version }, "حُدّث الملف قبل المراجعة.");
  }

  async function mutate(profile: OperatorProfile, action: "update-profile" | "approve" | "grant" | "invitation", extra: Record<string, unknown> = {}, successMessage = "") {
    setBusy(`${profile.id}:${action}`);
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const response = await identityFetch(`/api/access/operator-profiles/${encodeURIComponent(profile.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra, ...(action === "approve" || action === "grant" ? { expectedVersion: profile.version } : {}) }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        await load();
        setError(response.status === 409 || response.status === 412 ? `تغيّرت حالة الملف بالتزامن. راجع الحالة المحدّثة. ${message}` : message);
        return;
      }
      if (action === "invitation") setInvitation(await response.json() as OperatorProfileInvitationResponse);
      else await response.json();
      setNotice(successMessage || mutationSuccessLabel(action));
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر إكمال الإجراء. حدّث الحالة قبل أي محاولة أخرى.");
      await load();
    } finally {
      setBusy("");
    }
  }

  const activeFilterCount = Number(Boolean(appliedQuery)) + Number(state !== "all");

  return <section className="access-workspace-section profile-workspace" aria-labelledby="operator-profile-registry-title">
    <header className="access-section-heading profile-section-heading">
      <div>
        <h2 id="operator-profile-registry-title">ملفات المشغّلين</h2>
        <p>راجع الملف ثم نفّذ خطوته التالية.</p>
      </div>
      <details className="access-create-disclosure" ref={createDisclosure}>
        <summary className="button button-primary">مشغّل جديد</summary>
        <form className="access-create-form" onSubmit={(event) => void createProfile(event)} noValidate>
          <div className="access-create-form-heading"><h3>ملف جديد</h3><p>تُراجع البيانات قبل إنشاء حساب المشغّل.</p></div>
          <label className="field-label" htmlFor="operator-profile-name">الاسم بالعربية<input ref={createNameInput} id="operator-profile-name" autoComplete="name" maxLength={120} minLength={2} required aria-invalid={createNameInvalid} aria-describedby={createValidationError ? "operator-profile-create-validation" : undefined} value={fullNameAr} onChange={(event) => { setFullNameAr(event.target.value); setCreateNameInvalid((current) => current && Array.from(event.target.value.trim()).length < 2); setCreateValidationError(""); }} disabled={Boolean(busy)} /></label>
          <label className="field-label" htmlFor="operator-profile-phone">رقم الهاتف<input ref={createPhoneInput} id="operator-profile-phone" autoComplete="tel" inputMode="tel" required aria-invalid={createPhoneInvalid} aria-describedby={createValidationError ? "operator-profile-create-validation" : undefined} value={phoneE164} onChange={(event) => { const next = toAsciiDigits(event.target.value); setPhoneE164(next); setCreatePhoneInvalid((current) => current && !/^\+[1-9][0-9]{7,14}$/.test(normalizeYemenPhoneE164(next))); setCreateValidationError(""); }} disabled={Boolean(busy)} placeholder="مثال: 777 000 100" /></label>
          <label className="field-label" htmlFor="operator-profile-title">المسمى الوظيفي<input ref={createJobTitleInput} id="operator-profile-title" required minLength={1} maxLength={80} aria-invalid={createJobTitleInvalid} aria-describedby={createValidationError ? "operator-profile-create-validation" : undefined} value={jobTitle} onChange={(event) => { setJobTitle(event.target.value); setCreateJobTitleInvalid((current) => current && (event.target.value.trim().length < 1 || event.target.value.trim().length > 80)); setCreateValidationError(""); }} disabled={Boolean(busy)} placeholder="مثال: مدير عمليات" /></label>
          <label className="field-label" htmlFor="operator-profile-department">القسم<input ref={createDepartmentInput} id="operator-profile-department" required minLength={1} maxLength={80} aria-invalid={createDepartmentInvalid} aria-describedby={createValidationError ? "operator-profile-create-validation" : undefined} value={department} onChange={(event) => { setDepartment(event.target.value); setCreateDepartmentInvalid((current) => current && (event.target.value.trim().length < 1 || event.target.value.trim().length > 80)); setCreateValidationError(""); }} disabled={Boolean(busy)} placeholder="مثال: العمليات" /></label>
          {createValidationError ? <p id="operator-profile-create-validation" className="validation-error" role="alert">{createValidationError}</p> : null}
          <button type="submit" className="button button-primary" disabled={Boolean(busy)}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ للمراجعة"}</button>
        </form>
      </details>
    </header>

    {activeFilterCount > 0 ? <fieldset className="access-active-filters"><legend className="visually-hidden">المرشّحات النشطة</legend>
      {appliedQuery ? <button type="button" className="access-filter-chip" onClick={clearSearch}>البحث نشط<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح البحث</span></button> : null}
      {state !== "all" ? <button type="button" className="access-filter-chip" onClick={() => navigate("all", sort)}>المرحلة: {state === "pending_review" ? "بانتظار المراجعة" : state === "approved" ? "معتمد" : "مُنح الدور"}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح تصفية المرحلة</span></button> : null}
      {activeFilterCount > 1 ? <button type="button" className="access-clear-filters" onClick={clearFilters}>مسح الكل</button> : null}
    </fieldset> : null}

    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال العملية</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
    {invitation ? <div className="code-output" role="status"><span className="summary-label">رمز دعوة التفعيل · يظهر مرة واحدة</span><code>{invitation.enrollmentToken.code}</code><p>أُرسلت الدعوة إلى <bdi dir="ltr">{invitation.enrollmentToken.maskedPhone}</bdi>. تنتهي في {new Date(invitation.enrollmentToken.expiresAt).toLocaleString("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}

    {loading && items.length === 0 ? <div className="access-loading" role="status"><span className="loading-mark" aria-hidden="true" /> جارٍ قراءة الملفات…</div> : null}
    {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد ملفات مطابقة</strong><p>غيّر البحث أو أنشئ ملفًا جديدًا.</p></div> : null}

    {items.length > 0 ? <>
      <p className="access-result-count" aria-live="polite">{items.length} ملفًا محمّلًا{nextCursor ? " · توجد نتائج أخرى" : ""}</p>
      <div className="access-table-wrap" aria-busy={loading}>
        <table className="operations-table access-table profile-table">
          <caption className="visually-hidden">ملفات المشغّلين وحالتها والإجراء التالي</caption>
          <thead>
            <tr>
              <th scope="col">المشغّل</th>
              <th scope="col">الحالة</th>
              <th scope="col" aria-sort={sort === "created_asc" ? "ascending" : "descending"}>
                <button type="button" className="access-sort-button" onClick={() => navigate(state, sort === "created_desc" ? "created_asc" : "created_desc")}>تاريخ الإضافة <span aria-hidden="true">{sort === "created_desc" ? "↓" : "↑"}</span></button>
              </th>
              <th scope="col">الخطوة التالية</th>
            </tr>
            <tr className="access-filter-row">
              <th scope="col">
                <form className="access-column-search" onSubmit={search} noValidate>
                  <label className="visually-hidden" htmlFor="operator-profile-search">بحث بالاسم أو الهاتف</label>
                  <input ref={searchInput} id="operator-profile-search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اسم أو هاتف" />
                  {query ? <button type="button" className="access-input-clear" aria-label="مسح البحث" onClick={clearSearch}>×</button> : null}
                  <button type="submit" className="access-search-submit" disabled={loading}>بحث</button>
                </form>
              </th>
              <th scope="col">
                <label className="visually-hidden" htmlFor="operator-profile-state">تصفية حسب المرحلة</label>
                <select id="operator-profile-state" value={state} onChange={(event) => navigate(event.target.value as ProfileState, sort)} disabled={loading}>
                  <option value="all">كل المراحل</option><option value="pending_review">بانتظار المراجعة</option><option value="approved">معتمد</option><option value="admitted">مُنح الدور</option>
                </select>
              </th>
              <th scope="col"><span className="visually-hidden">ترتيب تاريخ الإضافة</span></th>
              <th scope="col"><span className="visually-hidden">الإجراء التالي</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((profile) => {
              const edit = edits[profile.id] ?? { fullNameAr: profile.fullNameAr, phoneE164: profile.phoneE164 ?? "", jobTitle: profile.jobTitle ?? "", department: profile.department ?? "" };
              const changed = edit.fullNameAr.trim() !== profile.fullNameAr || edit.phoneE164.replace(/\s+/g, "") !== profile.phoneE164 || edit.jobTitle.trim() !== (profile.jobTitle ?? "") || edit.department.trim() !== (profile.department ?? "");
              const active = profile.state === "admitted" && profile.roleEnabled === true && profile.securityEnabled === true && Boolean(profile.activatedAt);
              const canInvite = profile.state === "admitted" && profile.roleEnabled === true && profile.securityEnabled === true && !profile.activatedAt;
              const detailsComplete = Array.from(edit.jobTitle.trim()).length > 0 && Array.from(edit.department.trim()).length > 0;
              const nextLabel = profile.state === "pending_review" ? !detailsComplete ? "أكمل المسمى والقسم" : changed ? "احفظ التعديل أولًا" : "اعتماد الملف" : profile.state === "approved" ? "منح دور المشغّل" : canInvite ? "إصدار دعوة التفعيل" : active ? "اكتمل التفعيل" : "لا إجراء متاح";
              return <tr key={profile.id}>
                <th scope="row">
                  <div className="access-profile-identity"><strong>{profile.fullNameAr}</strong><bdi dir="ltr">{profile.phoneE164 || "رقم الهاتف غير متاح"}</bdi><small>{[profile.jobTitle || "المسمى غير مسجل", profile.department || "القسم غير مسجل"].join(" · ")}</small></div>
                  {profile.state === "pending_review" ? <details className="access-row-edit">
                    <summary>تعديل الملف</summary>
                    <div className="access-row-edit-fields">
                      <label className="field-label" htmlFor={`operator-profile-name-${profile.id}`}>الاسم<input id={`operator-profile-name-${profile.id}`} value={edit.fullNameAr} maxLength={120} disabled={Boolean(busy)} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: { ...edit, fullNameAr: event.target.value } }))} /></label>
                      <label className="field-label" htmlFor={`operator-profile-phone-${profile.id}`}>الهاتف<input id={`operator-profile-phone-${profile.id}`} inputMode="tel" value={edit.phoneE164} disabled={Boolean(busy)} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: { ...edit, phoneE164: toAsciiDigits(event.target.value) } }))} /></label>
                      <label className="field-label" htmlFor={`operator-profile-title-${profile.id}`}>المسمى الوظيفي<input id={`operator-profile-title-${profile.id}`} required minLength={1} maxLength={80} value={edit.jobTitle} disabled={Boolean(busy)} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: { ...edit, jobTitle: event.target.value } }))} /></label>
                      <label className="field-label" htmlFor={`operator-profile-department-${profile.id}`}>القسم<input id={`operator-profile-department-${profile.id}`} required minLength={1} maxLength={80} value={edit.department} disabled={Boolean(busy)} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: { ...edit, department: event.target.value } }))} /></label>
                      <button type="button" className="button button-secondary" disabled={Boolean(busy) || !changed} onClick={() => void updateProfile(profile)}>حفظ التعديل</button>
                    </div>
                  </details> : null}
                </th>
                <td><span className={`access-state-pill ${stateTone(profile)}`}>{stateLabel(profile)}</span></td>
                <td><time dateTime={profile.createdAt}>{profileDate(profile.createdAt)}</time></td>
                <td>
              {profile.state === "pending_review" ? <button type="button" className="button button-primary access-row-action" disabled={Boolean(busy) || changed || !detailsComplete} onClick={() => void mutate(profile, "approve")}>{busy === `${profile.id}:approve` ? "جارٍ الاعتماد…" : nextLabel}</button> : null}
                  {profile.state === "approved" ? <button type="button" className="button button-primary access-row-action" disabled={Boolean(busy)} onClick={() => void mutate(profile, "grant")}>{busy === `${profile.id}:grant` ? "جارٍ منح الدور…" : nextLabel}</button> : null}
                  {canInvite ? <button type="button" className="button button-primary access-row-action" disabled={Boolean(busy)} onClick={() => void mutate(profile, "invitation")}>{busy === `${profile.id}:invitation` ? "جارٍ إصدار الدعوة…" : nextLabel}</button> : null}
                  {profile.state === "admitted" && profile.activatedAt ? <span className="access-next-step">{active ? "مكتمل" : nextLabel}</span> : null}
                  {profile.state === "admitted" && !profile.activatedAt && !canInvite ? <span className="access-next-step">{nextLabel}</span> : null}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {nextCursor ? <div className="access-load-more"><button type="button" className="button button-secondary" disabled={loading || loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
    </> : null}
  </section>;
}
