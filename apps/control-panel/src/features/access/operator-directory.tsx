"use client";

import type { ActorRoleView } from "@bthwani/identity";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { operatorWorkspacePermissions } from "../../session/operator-permissions";
import { responseMessage } from "./identity-error-message";

type OperatorRow = ActorRoleView;
type OperatorPage = Readonly<{ items: ReadonlyArray<OperatorRow>; nextCursor?: string }>;
type CoverageFilter = "all" | "none" | "some" | "complete";

const pageSize = 10;

function identityStatus(operator: OperatorRow): Readonly<{ label: string; tone: string }> {
  if (!operator.securityEnabled) return { label: "الهوية موقوفة", tone: "is-paused" };
  if (!operator.enabled) return { label: "الدور موقوف", tone: "is-paused" };
  if (!operator.activatedAt) return { label: "بانتظار التفعيل", tone: "is-waiting" };
  return { label: "نشط", tone: "is-active" };
}

function enabledPermissionCount(operator: OperatorRow): number | null {
  const count = operator.operatorEnabledPermissionCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= operatorWorkspacePermissions.length ? count : null;
}

export function OperatorDirectory({ onSelectPhone, selectedPhone = "", selectionDisabled = false }: Readonly<{ onSelectPhone: (phone: string) => void; selectedPhone?: string; selectionDisabled?: boolean }>) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [enabled, setEnabled] = useState("");
  const [sort, setSort] = useState<"phone_asc" | "phone_desc">("phone_asc");
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [items, setItems] = useState<ReadonlyArray<OperatorRow>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const loadRequestId = useRef(0);
  const queryInput = useRef<HTMLInputElement>(null);

  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const nextEnabled = params.get("operatorEnabled") ?? "";
    const nextSort = params.get("operatorSort");
    const nextCoverage = params.get("operatorCoverage");
    setEnabled(nextEnabled === "true" || nextEnabled === "false" ? nextEnabled : "");
    setSort(nextSort === "phone_desc" ? "phone_desc" : "phone_asc");
    setCoverage(nextCoverage === "none" || nextCoverage === "some" || nextCoverage === "complete" ? nextCoverage : "all");
  }, []);

  useEffect(() => {
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  const navigate = useCallback((nextEnabled: string, nextSort: "phone_asc" | "phone_desc", nextCoverage: CoverageFilter) => {
    const params = new URLSearchParams(window.location.search);
    if (nextEnabled) params.set("operatorEnabled", nextEnabled); else params.delete("operatorEnabled");
    if (nextSort === "phone_desc") params.set("operatorSort", nextSort); else params.delete("operatorSort");
    if (nextCoverage !== "all") params.set("operatorCoverage", nextCoverage); else params.delete("operatorCoverage");
    const search = params.toString();
    window.history.pushState(window.history.state, "", window.location.pathname + (search ? `?${search}` : ""));
    setEnabled(nextEnabled);
    setSort(nextSort);
    setCoverage(nextCoverage);
    if (nextEnabled !== enabled || nextSort !== sort || nextCoverage !== coverage) {
      setItems([]);
      setNextCursor("");
      setError("");
    }
  }, [coverage, enabled, sort]);

  const load = useCallback(async (cursor = "", append = false) => {
    const requestId = ++loadRequestId.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: appliedQuery, limit: String(pageSize), sort });
      if (cursor) params.set("cursor", cursor);
      if (enabled) params.set("enabled", enabled);
      if (coverage !== "all") params.set("permissionCoverage", coverage);
      const response = await identityFetch(`/api/access/operators?${params.toString()}`);
      if (loadRequestId.current !== requestId) return;
      if (!response.ok) throw new Error(await responseMessage(response));
      const page = await response.json() as OperatorPage;
      if (loadRequestId.current !== requestId) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestId.current !== requestId) return;
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة قائمة المشغّلين.");
      if (!append) setItems([]);
      setNextCursor("");
    } finally {
      if (loadRequestId.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [appliedQuery, coverage, enabled, sort]);

  useEffect(() => { if (urlReady) void load(); }, [load, urlReady]);

  const activeFilterCount = Number(Boolean(appliedQuery)) + Number(Boolean(enabled)) + Number(coverage !== "all");

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Phone searches stay out of the URL and browser history because they contain personal data.
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
    queryInput.current?.focus();
  }

  function clearFilters() {
    navigate("", "phone_asc", "all");
    setQuery("");
    setAppliedQuery("");
    queryInput.current?.focus();
  }

  return <section className="operator-directory access-workspace-section" aria-labelledby="operator-directory-title">
    <header className="access-section-heading">
      <div>
        <h2 id="operator-directory-title">حسابات المشغّلين</h2>
        <p>اختر الحساب لفتح تفاصيله وإدارة الوصول.</p>
      </div>
    </header>

    {activeFilterCount > 0 ? <fieldset className="access-active-filters"><legend className="visually-hidden">المرشّحات النشطة</legend>
      {appliedQuery ? <button type="button" className="access-filter-chip" onClick={clearSearch}>بحث الهاتف نشط<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح البحث</span></button> : null}
      {enabled ? <button type="button" className="access-filter-chip" onClick={() => navigate("", sort, coverage)}>الدور: {enabled === "true" ? "مفعّل" : "موقوف"}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح تصفية الدور</span></button> : null}
        {coverage !== "all" ? <button type="button" className="access-filter-chip" onClick={() => navigate(enabled, sort, "all")}>الصلاحيات: {coverage === "none" ? "بلا صلاحيات" : coverage === "complete" ? "وصول كامل" : "صلاحيات جزئية"}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح تصفية الصلاحيات</span></button> : null}
      {activeFilterCount > 1 ? <button type="button" className="access-clear-filters" onClick={clearFilters}>مسح الكل</button> : null}
    </fieldset> : null}

    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر تحديث القائمة</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
    {loading && items.length === 0 ? <div className="access-loading" role="status"><span className="loading-mark" aria-hidden="true" /> جارٍ قراءة المشغّلين…</div> : null}
    {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد حسابات مطابقة</strong><p>غيّر البحث أو المرشّحات لعرض سجلات أخرى.</p></div> : null}

    {items.length > 0 ? <>
      <p className="access-result-count" aria-live="polite">{items.length} حسابات في الصفحة المحمّلة{nextCursor ? " · توجد نتائج أخرى" : ""}</p>
      {items.length > 0 ? <div className="access-table-wrap" aria-busy={loading}>
        <table className="operations-table access-table">
          <caption className="visually-hidden">قائمة حسابات المشغّلين، يمكن البحث والتصفية من عناوين الأعمدة</caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={sort === "phone_asc" ? "ascending" : "descending"}>
                <button type="button" className="access-sort-button" onClick={() => navigate(enabled, sort === "phone_asc" ? "phone_desc" : "phone_asc", coverage)}>
                  المشغّل <span aria-hidden="true">{sort === "phone_asc" ? "↑" : "↓"}</span>
                </button>
              </th>
              <th scope="col">الحالة</th>
              <th scope="col">الصلاحيات</th>
              <th scope="col">الإجراء</th>
            </tr>
            <tr className="access-filter-row">
              <th scope="col">
                <form className="access-column-search" onSubmit={search} noValidate>
                  <label className="visually-hidden" htmlFor="operator-search">بحث بالاسم أو الهاتف أو المسمى أو القسم</label>
                  <input ref={queryInput} id="operator-search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="الاسم أو الهاتف أو المسمى أو القسم" />
                  {query ? <button type="button" className="access-input-clear" aria-label="مسح البحث" onClick={clearSearch}>×</button> : null}
                  <button type="submit" className="access-search-submit" disabled={loading}>بحث</button>
                </form>
              </th>
              <th scope="col">
                <label className="visually-hidden" htmlFor="operator-enabled-filter">تصفية حسب حالة الدور</label>
                <select id="operator-enabled-filter" value={enabled} onChange={(event) => navigate(event.target.value, sort, coverage)} disabled={loading}>
                  <option value="">كل الحالات</option><option value="true">الدور مفعّل</option><option value="false">الدور موقوف</option>
                </select>
              </th>
              <th scope="col">
                <label className="visually-hidden" htmlFor="operator-coverage-filter">تصفية حسب نطاق الصلاحيات</label>
                <select id="operator-coverage-filter" value={coverage} onChange={(event) => navigate(enabled, sort, event.target.value as CoverageFilter)}>
                  <option value="all">أي مستوى وصول</option><option value="none">بلا صلاحيات</option><option value="some">صلاحيات جزئية</option><option value="complete">وصول كامل</option>
                </select>
              </th>
              <th scope="col"><span className="visually-hidden">إدارة الحساب</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((operator) => {
              const status = identityStatus(operator);
              const count = enabledPermissionCount(operator);
              return <tr key={operator.actorId} className={selectedPhone === operator.phoneE164 ? "is-selected" : undefined}>
                <th scope="row"><div className="access-profile-identity">{operator.fullNameAr?.trim() ? <><strong>{operator.fullNameAr.trim()}</strong><bdi dir="ltr" className="access-operator-phone">{operator.phoneE164}</bdi></> : <strong><bdi dir="ltr" className="access-operator-phone">{operator.phoneE164}</bdi></strong>}<small>{[operator.jobTitle || "المسمى غير مسجل", operator.department || "القسم غير مسجل"].join(" · ")}</small></div></th>
                <td><span className={`access-state-pill ${status.tone}`}>{status.label}</span></td>
                <td>{count === null ? <span className="muted">غير متاحة</span> : <span className="access-permission-count"><strong>{count}</strong><span>من {operatorWorkspacePermissions.length}</span></span>}</td>
                <td><button type="button" className="button button-secondary access-row-action" aria-haspopup="dialog" aria-expanded={selectedPhone === operator.phoneE164} aria-controls={selectedPhone === operator.phoneE164 ? "account-access-dialog" : undefined} disabled={selectionDisabled} onClick={() => onSelectPhone(operator.phoneE164)}>{selectedPhone === operator.phoneE164 ? "التفاصيل مفتوحة" : "عرض التفاصيل"}</button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : null}
      {nextCursor ? <div className="access-load-more"><button type="button" className="button button-secondary" disabled={loading || loadingMore} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل دفعة أخرى…" : "تحميل المزيد"}</button></div> : null}
    </> : null}
  </section>;
}
