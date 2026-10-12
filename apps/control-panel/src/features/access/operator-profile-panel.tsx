"use client";

import type { OperatorProfile, OperatorProfileInvitationResponse, OperatorProfilePage } from "@bthwani/identity";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "./identity-error-message";

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

function mutationSuccessLabel(action: "approve" | "grant" | "invitation"): string {
  if (action === "approve") return "اعتُمد الملف. الخطوة التالية منح الدور.";
  if (action === "grant") return "مُنح دور المشغّل. أصدر دعوة التفعيل عند الجاهزية.";
  return "تم تحديث الملف.";
}

function profileDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium" }).format(date);
}

export function OperatorProfilePanel() {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [state, setState] = useState<ProfileState>("all");
  const [sort, setSort] = useState<ProfileSort>("created_desc");
  const [items, setItems] = useState<ReadonlyArray<OperatorProfile>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const cursorPage = useCursorPage("operatorProfileCursor", appliedQuery, true, (value) => { setQuery(value); setAppliedQuery(value); });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitation, setInvitation] = useState<OperatorProfileInvitationResponse | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const loadRequestId = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get("profileState");
    const requestedSort = params.get("profileSort");
    setState(requestedState === "pending_review" || requestedState === "approved" || requestedState === "admitted" ? requestedState : "all");
    setSort(requestedSort === "created_asc" ? "created_asc" : "created_desc");
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
    cursorPage.reset();
    setState(nextState);
    setSort(nextSort);
    if (nextState !== state || nextSort !== sort) {
      setItems([]);
      setNextCursor("");
      setError("");
    }
  }, [cursorPage.reset, sort, state]);

  const load = useCallback(async (cursor = cursorPage.cursor) => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: appliedQuery, state, sort, limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/access/operator-profiles?${params.toString()}`);
      if (loadRequestId.current !== requestId) return;
      if (!response.ok) throw new Error(await responseMessage(response));
      const page = await response.json() as OperatorProfilePage;
      if (loadRequestId.current !== requestId) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestId.current !== requestId) return;
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة ملفات المشغّلين.");
      setItems([]);
      setNextCursor("");
    } finally {
      if (loadRequestId.current === requestId) {
        setLoading(false);

      }
    }
  }, [appliedQuery, sort, state, cursorPage.cursor]);

  useEffect(() => { if (urlReady && cursorPage.ready) void load(); }, [load, urlReady, cursorPage.ready]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Private searches stay in tab state, never in the URL.
    const nextQuery = query.trim().slice(0, 100);
    setQuery(nextQuery);
    if (nextQuery === appliedQuery) { void load(); return; }
    setAppliedQuery(nextQuery);
    setItems([]);
    setNextCursor("");
    setError("");
  }

  function clearSearch() {
    setQuery("");
    setAppliedQuery("");
    if (appliedQuery) { setItems([]); setNextCursor(""); setError(""); }
    searchInput.current?.focus();
  }

  function clearFilters() {
    navigate("all", "created_desc");
    setQuery("");
    setAppliedQuery("");
    searchInput.current?.focus();
  }

  async function mutate(profile: OperatorProfile, action: "approve" | "grant" | "invitation", extra: Record<string, unknown> = {}, successMessage = "") {
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
    </header>

    {activeFilterCount > 0 ? <fieldset className="access-active-filters"><legend className="visually-hidden">المرشّحات النشطة</legend>
      {appliedQuery ? <button type="button" className="access-filter-chip" onClick={clearSearch}>البحث نشط<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح البحث</span></button> : null}
      {state !== "all" ? <button type="button" className="access-filter-chip" onClick={() => navigate("all", sort)}>المرحلة: {state === "pending_review" ? "بانتظار المراجعة" : state === "approved" ? "معتمد" : "مُنح الدور"}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح تصفية المرحلة</span></button> : null}
      {activeFilterCount > 1 ? <button type="button" className="access-clear-filters" onClick={clearFilters}>مسح الكل</button> : null}
    </fieldset> : null}

    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error && items.length > 0 ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال العملية</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>تحديث القائمة</button></div> : null}
    {invitation ? <div className="code-output" role="status"><span className="summary-label">رمز دعوة التفعيل · يظهر مرة واحدة</span><code>{invitation.enrollmentToken.code}</code><p>أُرسلت الدعوة إلى <bdi dir="ltr">{invitation.enrollmentToken.maskedPhone}</bdi>. تنتهي في {new Date(invitation.enrollmentToken.expiresAt).toLocaleString("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}

    {items.length > 0 ? <p className="access-result-count" aria-live="polite">{items.length} ملفًا محمّلًا{nextCursor ? " · توجد نتائج أخرى" : ""}</p> : null}
    <div className="access-table-wrap" aria-busy={loading}>
        <table className="operations-table access-table profile-table">
          <caption className="visually-hidden">ملفات المشغّلين وحالتها والإجراء التالي</caption>
          <thead>
            <tr>
              <th scope="col">المشغّل</th>
              <th scope="col">الحالة</th>
              <th scope="col" aria-sort={sort === "created_asc" ? "ascending" : "descending"}>
                <button type="button" className="button button-quiet access-sort-button" onClick={() => navigate(state, sort === "created_desc" ? "created_asc" : "created_desc")}>تاريخ الإضافة <span aria-hidden="true">{sort === "created_desc" ? "↓" : "↑"}</span></button>
              </th>
              <th scope="col">الخطوة التالية</th>
            </tr>
            <tr className="access-filter-row">
              <th scope="col">
                <form className="access-column-search" onSubmit={search} noValidate>
                  <label className="visually-hidden" htmlFor="operator-profile-search">بحث بالاسم أو الهاتف</label>
                  <input ref={searchInput} id="operator-profile-search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اسم أو هاتف" />
                  {query ? <button type="button" className="button button-quiet access-input-clear" aria-label="مسح البحث" onClick={clearSearch}>×</button> : null}
                  <button type="submit" className="button button-secondary access-search-submit" disabled={loading}>بحث</button>
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
            {items.length === 0 ? <tr><td colSpan={4}>
              {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال العملية</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>تحديث القائمة</button></div>
                : loading ? <div className="access-loading" role="status"><span className="loading-mark" aria-hidden="true" /> جارٍ قراءة الملفات…</div>
                  : <div className="collection-state"><strong>لا توجد ملفات مطابقة</strong><p>غيّر البحث أو أنشئ ملفًا جديدًا.</p></div>}
            </td></tr> : null}
            {items.map((profile) => {
              const active = profile.state === "admitted" && profile.roleEnabled === true && profile.securityEnabled === true && Boolean(profile.activatedAt);
              const canInvite = profile.state === "admitted" && profile.roleEnabled === true && profile.securityEnabled === true && !profile.activatedAt;
              const detailsComplete = Array.from((profile.jobTitle ?? "").trim()).length > 0 && Array.from((profile.department ?? "").trim()).length > 0;
              const nextLabel = profile.state === "pending_review" ? !detailsComplete ? "أكمل المسمى والقسم" : "اعتماد الملف" : profile.state === "approved" ? "منح دور المشغّل" : canInvite ? "إصدار دعوة التفعيل" : active ? "اكتمل التفعيل" : "لا إجراء متاح";
              return <tr key={profile.id}>
                <th scope="row">
                  <div className="access-profile-identity"><strong>{profile.fullNameAr}</strong><bdi dir="ltr">{profile.phoneE164 || "رقم الهاتف غير متاح"}</bdi><small>{[profile.jobTitle || "المسمى غير مسجل", profile.department || "القسم غير مسجل"].join(" · ")}</small></div>
                </th>
                <td><span className={`access-state-pill ${stateTone(profile)}`}>{stateLabel(profile)}</span></td>
                <td><time dateTime={profile.createdAt}>{profileDate(profile.createdAt)}</time></td>
                <td>
              {profile.state === "pending_review" ? <button type="button" className="button button-primary access-row-action" disabled={Boolean(busy) || !detailsComplete} onClick={() => void mutate(profile, "approve")}>{busy === `${profile.id}:approve` ? "جارٍ الاعتماد…" : nextLabel}</button> : null}
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
    <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading || Boolean(busy)} label="صفحات ملفات المشغّلين" />
  </section>;
}
