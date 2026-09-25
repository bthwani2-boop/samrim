"use client";

import { type OperatorStoreSummary, fulfillmentModeLabel, publicationStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { downloadRegistryCsv } from "./registry-csv";
import "./partner-directory.module.css";
import "./store-workspace.module.css";

type StorePage = Readonly<{ stores: ReadonlyArray<OperatorStoreSummary>; nextCursor?: string }>;
type StoreHistory = Readonly<{ partnerStoreCursors?: ReadonlyArray<string> }>;
const pageSize = 10;
const publicationFilters = [
  { value: "", label: "كل حالات النشر" },
  { value: "unpublished", label: "غير منشور" },
  { value: "published", label: "منشور" },
  { value: "hidden", label: "مخفي" },
] as const;

export function StoreRegistry() {
  const [stores, setStores] = useState<ReadonlyArray<OperatorStoreSummary>>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [urlReady, setUrlReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get("state") ?? "";
    const requestedSearch = params.get("q")?.trim().slice(0, 128) ?? "";
    setFilter(publicationFilters.some((option) => option.value === requestedState) ? requestedState : "");
    setSearch(requestedSearch);
    setAppliedSearch(requestedSearch);
    setSort(params.get("sort") === "updated_asc" ? "updated_asc" : "updated_desc");
    setCursor(params.get("cursor") ?? "");
    const state = window.history.state as StoreHistory | null;
    setCursorStack(state?.partnerStoreCursors ?? []);
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  const navigate = useCallback((state: string, queryText: string, nextSort: string, pageCursor = "", pageCursors: ReadonlyArray<string> = []) => {
    const params = new URLSearchParams(window.location.search);
    if (state) params.set("state", state); else params.delete("state");
    if (queryText) params.set("q", queryText); else params.delete("q");
    if (nextSort !== "updated_desc") params.set("sort", nextSort); else params.delete("sort");
    if (pageCursor) params.set("cursor", pageCursor); else params.delete("cursor");
    const query = params.toString();
    window.history.pushState({ partnerStoreCursors: pageCursors }, "", window.location.pathname + (query ? `?${query}` : ""));
    setFilter(state);
    setSearch(queryText);
    setAppliedSearch(queryText);
    setSort(nextSort);
    setCursor(pageCursor);
    setCursorStack(pageCursors);
    setSelectedIds(new Set());
  }, []);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (filter) params.set("state", filter);
      if (appliedSearch) params.set("q", appliedSearch);
      if (sort !== "updated_desc") params.set("sort", sort);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/partners/stores?${params.toString()}`, { cache: "no-store" });
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as StorePage;
      if (sequence !== requestSequence.current) return;
      setStores(page.stores);
      setNextCursor(page.nextCursor ?? "");
      setSelectedIds(new Set());
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة سجل المتاجر من DSH.");
      setStores([]);
      setNextCursor("");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [appliedSearch, cursor, filter, sort]);

  const selectedOnPage = stores.filter((store) => selectedIds.has(store.id)).length;
  const allSelected = stores.length > 0 && selectedOnPage === stores.length;

  function toggleSelected(storeId: string) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (updated.has(storeId)) updated.delete(storeId); else updated.add(storeId);
      return updated;
    });
  }

  function exportSelected() {
    const selected = stores.filter((store) => selectedIds.has(store.id));
    if (!selected.length) return;
    downloadRegistryCsv("store-registry-selection.csv", ["المتجر", "المعرّف", "الشريك", "مدينة الخدمة", "الفئة", "النشر", "أوضاع الطلب"], selected.map((store) => [store.name, store.id, store.partnerActorId, store.serviceCityId || "غير محددة", store.primaryVerticalId || "غير محددة", publicationStateLabel(store.publicationState), store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"]));
  }

  useEffect(() => {
    if (urlReady) void load();
  }, [load, urlReady]);

  return (
    <section className="workspace-page store-registry" aria-labelledby="store-registry-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">الشركاء · سجل المتاجر</p>
        <h1 id="store-registry-title">المتاجر</h1>
        <p className="lead">سجل DSH الموحّد لكل المتاجر، بما فيها غير المنشورة. افتح ملف المتجر لمراجعة الجاهزية والنشر وأوضاع الطلب.</p>
      </div>

      <div className="workspace-toolbar store-registry-toolbar">
        <search className="store-registry-search" aria-label="البحث في المتاجر">
          <form className="store-registry-search-form" onSubmit={(event) => { event.preventDefault(); navigate(filter, search.trim().slice(0, 128), sort); }}>
            <label className="field-label" htmlFor="partner-store-search">البحث باسم المتجر أو معرّفه أو الشريك<input id="partner-store-search" type="search" value={search} maxLength={128} onChange={(event) => setSearch(event.target.value)} placeholder="اسم متجر أو معرّف" /></label>
            <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          </form>
        </search>
        <label className="field-label" htmlFor="partner-store-publication-filter">حالة النشر<select id="partner-store-publication-filter" value={filter} onChange={(event) => navigate(event.target.value, appliedSearch, sort)} disabled={loading}>{publicationFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="field-label" htmlFor="partner-store-sort">ترتيب آخر تحديث<select id="partner-store-sort" value={sort} onChange={(event) => navigate(filter, appliedSearch, event.target.value)} disabled={loading}><option value="updated_desc">الأحدث تحديثًا</option><option value="updated_asc">الأقدم تحديثًا</option></select></label>
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
      </div>

      {filter || appliedSearch ? <section className="active-filter-chips" aria-label="عوامل البحث والتصفية النشطة">
        {filter ? <button type="button" className="filter-chip" onClick={() => navigate("", appliedSearch, sort)}>النشر: {publicationFilters.find((option) => option.value === filter)?.label}<span aria-hidden="true">×</span><span className="visually-hidden">مسح تصفية النشر</span></button> : null}
        {appliedSearch ? <button type="button" className="filter-chip" onClick={() => navigate(filter, "", sort)}>البحث: {appliedSearch}<span aria-hidden="true">×</span><span className="visually-hidden">مسح البحث</span></button> : null}
        <button type="button" className="button button-secondary" onClick={() => navigate("", "", "updated_desc")}>مسح الكل</button>
      </section> : null}

      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة المتاجر</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
      {loading && stores.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة سجل المتاجر</strong></div> : null}
      {!loading && !error && stores.length === 0 ? <div className="collection-state"><strong>{filter || appliedSearch ? "لا توجد متاجر تطابق عوامل البحث والتصفية" : "لا توجد متاجر في DSH حاليًا"}</strong><p>{filter || appliedSearch ? "امسح عاملًا أو غيّره لعرض نتائج أخرى." : "تظهر المتاجر هنا بعد إنشائها عبر مسار انضمام الشريك."}</p></div> : null}

      {stores.length > 0 ? <>
        <div className="partner-registry-summary"><span>الصفحة الحالية · {stores.length} متجرًا</span><fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات المتاجر المحددة</legend><span aria-live="polite">المحدد: {selectedOnPage}</span><button type="button" className="button button-secondary" onClick={exportSelected} disabled={selectedOnPage === 0}>تصدير المحدد CSV</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={selectedOnPage === 0}>إلغاء التحديد</button></fieldset></div>
        <div className="store-registry-table-wrap"><table className="operations-table partner-registry-table">
          <caption className="visually-hidden">سجل المتاجر الحالي من DSH</caption>
          <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input aria-label={allSelected ? "إلغاء تحديد كل المتاجر" : "تحديد كل المتاجر في الصفحة"} type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(stores.map((store) => store.id)) : new Set())} /></th><th scope="col">المتجر</th><th scope="col">الشريك</th><th scope="col">مدينة الخدمة</th><th scope="col">الفئة الرئيسية</th><th scope="col">النشر</th><th scope="col">أوضاع الطلب</th><th scope="col">آخر تحديث</th></tr></thead>
          <tbody>{stores.map((store) => <tr key={store.id}>
            <td><input type="checkbox" aria-label={`تحديد متجر ${store.name}`} checked={selectedIds.has(store.id)} onChange={() => toggleSelected(store.id)} /></td>
            <th scope="row"><Link href={`/partners/stores/${encodeURIComponent(store.id)}`}>{store.name}</Link><small className="store-registry-id"><bdi dir="ltr">{store.id}</bdi></small></th>
            <td><Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`}><bdi dir="ltr">{store.partnerActorId}</bdi></Link></td>
            <td>{store.serviceCityId ? <bdi dir="ltr">{store.serviceCityId}</bdi> : "غير محددة"}</td>
            <td>{store.primaryVerticalId ? <bdi dir="ltr">{store.primaryVerticalId}</bdi> : "غير محددة"}</td>
            <td>{publicationStateLabel(store.publicationState)}</td>
            <td>{store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"}</td>
            <td><time dateTime={store.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(store.updatedAt))}</time></td>
          </tr>)}</tbody>
        </table></div>
        <nav className="partner-registry-pagination" aria-label="صفحات سجل المتاجر"><button type="button" className="button button-secondary" disabled={loading || cursorStack.length === 0} onClick={() => navigate(filter, appliedSearch, sort, cursorStack.at(-1) ?? "", cursorStack.slice(0, -1))}>السابق</button><span>{cursorStack.length + 1}</span><button type="button" className="button button-secondary" disabled={loading || !nextCursor} onClick={() => navigate(filter, appliedSearch, sort, nextCursor, [...cursorStack, cursor])}>التالي</button></nav>
      </> : null}
    </section>
  );
}
