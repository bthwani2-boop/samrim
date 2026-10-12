"use client";

import { fulfillmentModeLabel, type OperatorStoreSummary, publicationStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { PageHeader } from "../../shell/page-header";
import { partnerErrorMessage } from "./partner-error-message";
import { downloadRegistryCsv } from "./registry-csv";
import { StoreInspector } from "./store-inspector";

type StorePage = Readonly<{ stores: ReadonlyArray<OperatorStoreSummary>; nextCursor?: string }>;
const pageSize = 10;
const publicationFilters = [
  { value: "", label: "كل حالات النشر" },
  { value: "unpublished", label: "غير منشور" },
  { value: "published", label: "منشور" },
  { value: "hidden", label: "مخفي" },
] as const;

export function StoreRegistry() {
  const [stores, setStores] = useState<ReadonlyArray<OperatorStoreSummary>>([]);
  const router = useRouter();
  const pathname = usePathname();
  const queryString = useSearchParams().toString();
  const params = new URLSearchParams(queryString);
  const requestedState = params.get("state") ?? "";
  const filter = publicationFilters.some((option) => option.value === requestedState) ? requestedState : "";
  const appliedSearch = (params.get("q") ?? "").trim().slice(0, 128);
  const sort = params.get("sort") === "updated_asc" ? "updated_asc" : "updated_desc";
  const inspectId = (params.get("inspect") ?? "").slice(0, 128);
  const [search, setSearch] = useState(appliedSearch);
  const cursorPage = useCursorPage("cursor", JSON.stringify([filter, appliedSearch, sort]));
  const cursor = cursorPage.cursor;
  const inspectorOrigin = useRef<HTMLElement | null>(null);
  const [nextCursor, setNextCursor] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  useEffect(() => setSearch(appliedSearch), [appliedSearch]);

  const navigate = useCallback((state: string, queryText: string, nextSort: string) => {
    cursorPage.clearForNavigation();
    const next = new URLSearchParams(window.location.search);
    if (state) next.set("state", state); else next.delete("state");
    if (queryText) next.set("q", queryText); else next.delete("q");
    if (nextSort !== "updated_desc") next.set("sort", nextSort); else next.delete("sort");
    next.delete("cursor"); next.delete("inspect");
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    setSelectedIds(new Set());
  }, [cursorPage.clearForNavigation, pathname, router]);

  function storeHref(id: string) {
    const next = new URLSearchParams(queryString);
    if (cursor) next.set("cursor", cursor); else next.delete("cursor");
    next.set("inspect", id);
    return `/partners/stores/${encodeURIComponent(id)}?${next}`;
  }

  function inspectStore(id: string) {
    inspectorOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = new URLSearchParams(window.location.search); next.set("inspect", id);
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function closeInspector() {
    const id = inspectId;
    const next = new URLSearchParams(window.location.search); next.delete("inspect");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    requestAnimationFrame(() => {
      const trigger = inspectorOrigin.current?.isConnected ? inspectorOrigin.current : document.getElementById(`store-inspection-${id}`);
      (trigger ?? document.getElementById("partner-store-search"))?.focus();
    });
  }

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
      const response = await fetch(`/api/partners/stores?${params.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as StorePage;
      if (sequence !== requestSequence.current) return;
      if (!Array.isArray(page?.stores) || (page.nextCursor !== undefined && typeof page.nextCursor !== "string")) throw new Error("استجابة سجل المتاجر غير صالحة. أعد القراءة.");
      setStores(page.stores);
      setNextCursor(page.nextCursor ?? "");
      setSelectedIds(new Set());
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة سجل المتاجر .");
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
    downloadRegistryCsv("store-registry-selection.csv", ["المتجر", "الشريك", "مدينة الخدمة", "الفئة", "النشر", "أوضاع الطلب"], selected.map((store) => [store.name, store.partnerName || "ملف الشريك", store.serviceCityName || "غير محددة", store.primaryVerticalName || "غير محددة", publicationStateLabel(store.publicationState), store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"]));
  }

  useEffect(() => {
    if (cursorPage.ready) void load();
    return () => { requestSequence.current += 1; };
  }, [load, cursorPage.ready]);

  return (
    <section className="workspace-page store-registry" aria-labelledby="store-registry-title">
      <PageHeader id="store-registry-title" title="المتاجر" actions={!loading && stores.length === 0 ? <Link className="button button-secondary" href="/catalog/trash">سلة المحذوفات</Link> : null} />

      {inspectId ? <StoreInspector key={inspectId} storeId={inspectId} detailHref={storeHref(inspectId)} onClose={closeInspector} /> : null}

      <div className="workspace-toolbar store-registry-toolbar">
        <search className="store-registry-search" aria-label="البحث في المتاجر">
          <form className="store-registry-search-form" noValidate onSubmit={(event) => { event.preventDefault(); navigate(filter, search.trim().slice(0, 128), sort); }}>
            <label className="field-label" htmlFor="partner-store-search">البحث باسم المتجر أو الشريك<input id="partner-store-search" type="search" value={search} maxLength={128} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المتجر أو الشريك" /></label>
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
      {!loading && !error && stores.length === 0 ? <div className="collection-state"><strong>{filter || appliedSearch ? "لا توجد متاجر تطابق عوامل البحث والتصفية" : "لا توجد متاجر حاليًا"}</strong><p>{filter || appliedSearch ? "امسح عاملًا أو غيّره لعرض نتائج أخرى." : "تظهر المتاجر هنا بعد إنشائها عبر مسار انضمام الشريك."}</p></div> : null}

      {stores.length > 0 ? <>
        <div className="partner-registry-summary"><span>الصفحة الحالية · {stores.length} متجرًا</span><fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات المتاجر المحددة</legend><span aria-live="polite">المحدد: {selectedOnPage}</span><button type="button" className="button button-secondary" onClick={exportSelected} disabled={selectedOnPage === 0}>تصدير المحدد</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={selectedOnPage === 0}>إلغاء التحديد</button></fieldset></div>
        <div className="store-registry-table-wrap"><table className="operations-table partner-registry-table">
          <caption className="visually-hidden">سجل المتاجر الحالي </caption>
          <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input aria-label={allSelected ? "إلغاء تحديد كل المتاجر" : "تحديد كل المتاجر في الصفحة"} type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(stores.map((store) => store.id)) : new Set())} /></th><th scope="col">المتجر</th><th scope="col">الشريك</th><th scope="col">مدينة الخدمة</th><th scope="col">النشاط الرئيسي</th><th scope="col">النشر</th><th scope="col">أوضاع الطلب</th><th scope="col">آخر تحديث</th></tr></thead>
          <tbody>{stores.map((store) => <tr key={store.id}>
            <td><input type="checkbox" aria-label={`تحديد متجر ${store.name}`} checked={selectedIds.has(store.id)} onChange={() => toggleSelected(store.id)} /></td>
            <th scope="row"><div className="action-row store-registry-name"><Link href={storeHref(store.id)}>{store.name}</Link><button id={`store-inspection-${store.id}`} className="button button-quiet" type="button" aria-label={`معاينة متجر ${store.name}`} onClick={() => inspectStore(store.id)}>معاينة</button></div></th>
            <td><Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`}>{store.partnerName || "ملف الشريك"}</Link></td>
            <td>{store.serviceCityName || "غير محددة"}</td>
            <td>{store.primaryVerticalName || "غير محددة"}</td>
            <td>{publicationStateLabel(store.publicationState)}</td>
            <td>{store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"}</td>
            <td><time dateTime={store.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(store.updatedAt))}</time></td>
          </tr>)}</tbody>
        </table></div>

      </> : null}
      <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات سجل المتاجر" />
    </section>
  );
}
