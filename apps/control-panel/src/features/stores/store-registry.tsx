"use client";

import { fulfillmentModeLabel, type OperatorStoreSummary, publicationStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { PageHeader } from "../../shell/page-header";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { downloadRegistryCsv } from "../shared/registry-csv";
import { StoreInspector } from "./store-inspector";
import { StoreLogo } from "./store-logo";
import { AccountIndicator, FulfillmentIndicators, PublicationIndicator, StoreIndicatorLegend } from "./store-indicators";
import { OperationalIcon } from "../../shell/workspace-icon";
import { useReadOnReturn } from "../shared/use-read-on-return";

type RegistryRow = { kind: "store"; store: OperatorStoreSummary; partnerRole: ActorRoleView | null } | { kind: "partner"; actor: ActorRoleView };
type StorePage = Readonly<{ rows: ReadonlyArray<RegistryRow>; nextCursor?: string }>;
const isPhoneQuery = (value: string) => /^\+?[\d\s-]{5,}$/.test(value) && value.replace(/\D/g, "").length >= 5;
const publicationFilters = [
  { value: "", label: "كل حالات النشر" },
  { value: "unpublished", label: "غير منشور" },
  { value: "published", label: "منشور" },
  { value: "hidden", label: "مخفي" },
] as const;

export function StoreRegistry() {
  const [rows, setRows] = useState<ReadonlyArray<RegistryRow>>([]);
  const stores = rows.flatMap((row) => row.kind === "store" ? [row.store] : []);
  const router = useRouter();
  const pathname = usePathname();
  const queryString = useSearchParams().toString();
  const params = new URLSearchParams(queryString);
  const requestedState = params.get("state") ?? "";
  const serviceCityId = (params.get("serviceCityId") ?? "").slice(0, 128);
  const filter = publicationFilters.some((option) => option.value === requestedState) ? requestedState : "";
  const urlSearch = (params.get("q") ?? "").trim().slice(0, 100);
  const [privateSearch, setPrivateSearch] = useState("");
  const appliedSearch = urlSearch || privateSearch;
  const mode = ["all", "stores", "without_store"].includes(params.get("mode") ?? "") ? params.get("mode") ?? "all" : "all";
  const sort = params.get("sort") === "updated_asc" ? "updated_asc" : "updated_desc";
  const inspectId = (params.get("inspect") ?? "").slice(0, 128);
  const [search, setSearch] = useState(appliedSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cities, setCities] = useState<ReadonlyArray<{ id: string; displayNameAr: string }>>([]);
  const cursorPage = useCursorPage("cursor", JSON.stringify([filter, appliedSearch, sort, mode, serviceCityId]), "mixed", (key) => {
    try { const value = JSON.parse(key) as unknown[]; if (typeof value[1] === "string" && isPhoneQuery(value[1])) setPrivateSearch(value[1]); } catch { /* invalid saved page filters */ }
  });
  const cursor = cursorPage.cursor;
  const inspectorOrigin = useRef<HTMLElement | null>(null);
  const [nextCursor, setNextCursor] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navigationVersion, setNavigationVersion] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => setSearch(appliedSearch), [appliedSearch]);
  useEffect(() => {
    const sync = () => setPrivateSearch(typeof window.history.state?.partnerRegistryPrivateSearch === "string" ? window.history.state.partnerRegistryPrivateSearch : "");
    const initial = new URLSearchParams(window.location.search);
    const initialQuery = initial.get("q")?.trim() ?? "";
    if (isPhoneQuery(initialQuery)) {
      initial.delete("q");
      window.history.replaceState({ ...window.history.state, partnerRegistryPrivateSearch: initialQuery }, "", `${window.location.pathname}${initial.size ? `?${initial}` : ""}`);
    }
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/service-cities", { cache: "no-store" }).then(async (response) => response.ok ? await response.json() as { cities?: ReadonlyArray<{ id: string; displayNameAr: string }> } : null).then((data) => { if (active && Array.isArray(data?.cities)) setCities(data.cities); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const navigate = useCallback((state: string, queryText: string, nextSort: string, nextMode = mode, nextCity = serviceCityId) => {
    cursorPage.clearForNavigation();
    const next = new URLSearchParams(window.location.search);
    if (state) next.set("state", state); else next.delete("state");
    const sensitive = isPhoneQuery(queryText);
    if (queryText && !sensitive) next.set("q", queryText); else next.delete("q");
    if (nextSort !== "updated_desc") next.set("sort", nextSort); else next.delete("sort");
    if (nextMode !== "all") next.set("mode", nextMode); else next.delete("mode");
    if (nextCity) next.set("serviceCityId", nextCity); else next.delete("serviceCityId");
    next.delete("cursor"); next.delete("inspect");
    const href = `${pathname}${next.size ? `?${next}` : ""}`;
    if (sensitive) {
      window.history.pushState({ ...window.history.state, partnerRegistryPrivateSearch: queryText }, "", href);
      setPrivateSearch(queryText);
      setNavigationVersion((version) => version + 1);
    } else {
      router.push(href, { scroll: false });
      setPrivateSearch("");
    }
    setSelectedIds(new Set());
  }, [cursorPage.clearForNavigation, pathname, router, mode, serviceCityId]);

  function storeHref(id: string) {
    const next = new URLSearchParams(queryString);
    if (cursor) next.set("cursor", cursor); else next.delete("cursor");
    next.set("inspect", id);
    return `/partners/stores/${encodeURIComponent(id)}?${next}`;
  }

  function inspectStore(id: string, rememberOrigin = true) {
    if (rememberOrigin) inspectorOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = new URLSearchParams(window.location.search); next.set("inspect", id);
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function closeInspector() {
    const id = inspectId;
    const next = new URLSearchParams(window.location.search); next.delete("inspect");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    requestAnimationFrame(() => {
      const trigger = inspectorOrigin.current?.isConnected ? inspectorOrigin.current : [document.getElementById(`store-inspection-${id}`), document.getElementById(`store-inspection-${id}-mobile`)].find((element) => element && element.getClientRects().length > 0);
      (trigger ?? document.getElementById("partner-store-search"))?.focus();
    });
  }

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode });
      if (filter) params.set("state", filter);
      if (serviceCityId) params.set("serviceCityId", serviceCityId);
      if (appliedSearch && !isPhoneQuery(appliedSearch)) params.set("q", appliedSearch);
      if (sort !== "updated_desc") params.set("sort", sort);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/partners/registry?${params.toString()}`, { method: isPhoneQuery(appliedSearch) ? "POST" : "GET", ...(isPhoneQuery(appliedSearch) ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: appliedSearch }) } : {}), cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as StorePage;
      if (sequence !== requestSequence.current) return;
      if (!Array.isArray(page?.rows) || (page.nextCursor !== undefined && typeof page.nextCursor !== "string")) throw new Error("استجابة سجل الشركاء والمتاجر غير صالحة. أعد القراءة.");
      setRows(page.rows);
      setNextCursor(page.nextCursor ?? "");
      setSelectedIds((current) => new Set(page.rows.flatMap((row) => row.kind === "store" && current.has(row.store.id) ? [row.store.id] : [])));
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة سجل المتاجر .");
      setRows([]);
      setNextCursor("");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [appliedSearch, cursor, filter, sort, mode, serviceCityId]);
  useReadOnReturn(load, cursorPage.ready && !loading);

  const selectedOnPage = stores.filter((store) => selectedIds.has(store.id)).length;
  const allSelected = stores.length > 0 && selectedOnPage === stores.length;
  const inspectedIndex = stores.findIndex((store) => store.id === inspectId);

  function storeIdentity(row: Extract<RegistryRow, { kind: "store" }>, mobile = false) {
    return <div className="store-registry-identity">
      <StoreLogo name={row.store.name} uri={row.store.storeProfileImage?.uri} />
      <div className="store-registry-identity-copy">
        <div className="store-registry-name"><Link href={storeHref(row.store.id)}>{row.store.name}</Link><button id={`store-inspection-${row.store.id}${mobile ? "-mobile" : ""}`} className="store-registry-inspect-button" type="button" title="معاينة المتجر" aria-label={`معاينة متجر ${row.store.name}`} onClick={() => inspectStore(row.store.id)}><OperationalIcon name="published" /></button></div>
        <div className="store-registry-owner"><Link href={`/partners/actors/${encodeURIComponent(row.store.partnerActorId)}`}>{row.store.partnerName && row.store.partnerName !== row.store.name ? row.store.partnerName : "ملف الشريك"}</Link>{row.partnerRole?.phoneE164 ? <a className="store-registry-secondary" href={`tel:${row.partnerRole.phoneE164}`}><bdi dir="ltr">{row.partnerRole.phoneE164}</bdi></a> : null}</div>
      </div>
    </div>;
  }

  function storeLocation(store: OperatorStoreSummary) {
    return <span className="store-registry-location"><span>{store.serviceCityName || "—"}</span>{store.deliveryOrigin ? <a className="store-registry-map" href={`https://www.google.com/maps?q=${store.deliveryOrigin.latitude},${store.deliveryOrigin.longitude}`} target="_blank" rel="noopener noreferrer" title="عرض الموقع" aria-label={`موقع متجر ${store.name} على الخريطة`}><OperationalIcon name="map" /></a> : null}</span>;
  }

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
    // Private history-only navigation increments the revision to request a fresh canonical page.
    if (cursorPage.ready && navigationVersion >= 0) void load();
    return () => { requestSequence.current += 1; };
  }, [load, cursorPage.ready, navigationVersion]);
  useEffect(() => {
    if (!cursorPage.ready) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [cursorPage.ready, load]);

  return (
    <section className="workspace-page store-registry" data-inspecting={Boolean(inspectId)} aria-labelledby="store-registry-title">
      <PageHeader id="store-registry-title" title="الشركاء والمتاجر" />

      {inspectId ? <StoreInspector key={inspectId} storeId={inspectId} detailHref={storeHref(inspectId)} onClose={closeInspector} onPrevious={inspectedIndex > 0 ? () => inspectStore(stores[inspectedIndex - 1]!.id, false) : undefined} onNext={inspectedIndex >= 0 && inspectedIndex < stores.length - 1 ? () => inspectStore(stores[inspectedIndex + 1]!.id, false) : undefined} /> : null}

      <div className="workspace-toolbar store-registry-toolbar">
        <search className="store-registry-search" aria-label="البحث في الشركاء والمتاجر">
          <form className="store-registry-search-form" noValidate onSubmit={(event) => { event.preventDefault(); navigate(filter, search.trim().slice(0, 100), sort); }}>
            <label className="field-label" htmlFor="partner-store-search">اسم المتجر أو الشريك أو هاتفه<input id="partner-store-search" type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="الاسم أو رقم الهاتف" /></label>
            <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          </form>
        </search>
        <div className="store-registry-filters" data-open={filtersOpen}><button type="button" className="button button-secondary store-registry-filter-toggle" aria-expanded={filtersOpen} aria-controls="store-registry-filter-controls" onClick={() => setFiltersOpen(!filtersOpen)}>الفلاتر والترتيب{filter || serviceCityId || mode !== "all" || sort !== "updated_desc" ? " · مفعلة" : ""}</button><div id="store-registry-filter-controls">
        <label className="field-label" htmlFor="partner-registry-mode">عرض السجل<select id="partner-registry-mode" value={mode} onChange={(event) => navigate(event.target.value === "without_store" ? "" : filter, appliedSearch, sort, event.target.value, event.target.value === "without_store" ? "" : serviceCityId)} disabled={loading}><option value="all">الشركاء والمتاجر</option><option value="stores">المتاجر فقط</option><option value="without_store">شركاء دون متاجر</option></select></label>
        <label className="field-label" htmlFor="partner-store-publication-filter">حالة النشر<select id="partner-store-publication-filter" value={filter} onChange={(event) => navigate(event.target.value, appliedSearch, sort)} disabled={loading || mode === "without_store"}>{publicationFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="field-label" htmlFor="partner-registry-city">المدينة<select id="partner-registry-city" value={serviceCityId} onChange={(event) => navigate(filter, appliedSearch, sort, mode, event.target.value)} disabled={loading || mode === "without_store"}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="partner-store-sort">ترتيب آخر تحديث<select id="partner-store-sort" value={sort} onChange={(event) => navigate(filter, appliedSearch, event.target.value)} disabled={loading}><option value="updated_desc">الأحدث تحديثًا</option><option value="updated_asc">الأقدم تحديثًا</option></select></label>
        </div></div>

      </div>

      {filter || appliedSearch || serviceCityId || mode !== "all" || sort !== "updated_desc" ? <section className="active-filter-chips" aria-label="عوامل البحث والتصفية النشطة">
        {filter ? <button type="button" className="filter-chip" onClick={() => navigate("", appliedSearch, sort)}>النشر: {publicationFilters.find((option) => option.value === filter)?.label}<span aria-hidden="true">×</span><span className="visually-hidden">مسح تصفية النشر</span></button> : null}
        {appliedSearch ? <button type="button" className="filter-chip" onClick={() => navigate(filter, "", sort)}>البحث: {appliedSearch}<span aria-hidden="true">×</span><span className="visually-hidden">مسح البحث</span></button> : null}
        {serviceCityId ? <button type="button" className="filter-chip" onClick={() => navigate(filter, appliedSearch, sort, mode, "")}>المدينة: {cities.find((city) => city.id === serviceCityId)?.displayNameAr || "مدينة محددة"}<span aria-hidden="true">×</span></button> : null}
        {mode !== "all" ? <button type="button" className="filter-chip" onClick={() => navigate(filter, appliedSearch, sort, "all")}>{mode === "stores" ? "المتاجر فقط" : "شركاء دون متاجر"}<span aria-hidden="true">×</span></button> : null}
        {sort !== "updated_desc" ? <button type="button" className="filter-chip" onClick={() => navigate(filter, appliedSearch, "updated_desc")}>الأقدم تحديثًا<span aria-hidden="true">×</span></button> : null}
        <button type="button" className="button button-secondary" onClick={() => navigate("", "", "updated_desc", "all", "")}>مسح الكل</button>
      </section> : null}

      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة الشركاء والمتاجر</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
      {loading && rows.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة الشركاء والمتاجر</strong></div> : null}
      {!loading && !error && rows.length === 0 ? <div className="collection-state"><strong>{nextCursor ? "لا توجد سجلات مطابقة في هذا الجزء من النتائج" : "لا توجد نتائج مطابقة"}</strong><p>{nextCursor ? "يمكن الانتقال إلى الصفحة التالية للمتابعة دون تحميل كامل السجل." : "غيّر عوامل البحث أو امسحها."}</p></div> : null}

      {rows.length > 0 ? <>
        <div className="partner-registry-summary"><span>الصفحة الحالية · {rows.length} سجلًا</span><fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات المتاجر المحددة</legend><span aria-live="polite">المحدد: {selectedOnPage}</span><button type="button" className="button button-secondary" onClick={exportSelected} disabled={selectedOnPage === 0}>تصدير المحدد</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={selectedOnPage === 0}>إلغاء التحديد</button></fieldset></div>
        <div className="store-registry-table-wrap"><table className="operations-table partner-registry-table">
          <caption className="visually-hidden">سجل موحد يعرض صفًا لكل متجر، وصفًا للشريك الذي لا يملك متجرًا، مع عرض حالة حسابه</caption>
          <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input aria-label={allSelected ? "إلغاء تحديد كل المتاجر" : "تحديد كل المتاجر في الصفحة"} type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(stores.map((store) => store.id)) : new Set())} /></th><th scope="col">الشريك / المتجر</th><th scope="col">المدينة</th><th scope="col">النشاط والنوع</th><th scope="col" className="indicator-column">الحساب</th><th scope="col" className="indicator-column">النشر</th><th scope="col" className="fulfillment-column">التوصيل</th><th scope="col">آخر تحديث</th></tr></thead>
          <tbody>{rows.map((row) => row.kind === "store" ? <tr key={row.store.id}>
            <td><input type="checkbox" aria-label={`تحديد متجر ${row.store.name}`} checked={selectedIds.has(row.store.id)} onChange={() => toggleSelected(row.store.id)} /></td>
            <th scope="row">{storeIdentity(row)}</th>
            <td>{storeLocation(row.store)}</td>
            <td><div className="store-registry-cell-stack"><span>{row.store.primaryVerticalName || "—"}</span><span className="store-registry-secondary">{row.store.commercialStoreTypeNameAr || <><span aria-hidden="true">—</span><span className="visually-hidden">نوع المتجر غير محدد</span></>}</span></div></td>
            <td className="indicator-column"><AccountIndicator role={row.partnerRole} /></td>
            <td className="indicator-column"><PublicationIndicator state={row.store.publicationState} /></td>
            <td className="fulfillment-column"><FulfillmentIndicators modes={row.store.fulfillmentModes} /></td>
            <td><time dateTime={row.store.updatedAt} className="store-registry-time">{new Intl.DateTimeFormat("ar-YE", { dateStyle: "short" }).format(new Date(row.store.updatedAt))}<small>{new Intl.DateTimeFormat("ar-YE", { timeStyle: "short" }).format(new Date(row.store.updatedAt))}</small></time></td>
          </tr> : <tr key={`partner-${row.actor.actorId}`}>
            <td aria-label="حساب بلا متجر">—</td>
            <th scope="row"><Link href={`/partners/actors/${encodeURIComponent(row.actor.actorId)}`}><bdi dir="ltr">{row.actor.phoneE164}</bdi></Link><div className="store-registry-owner">شريك دون متجر</div></th>
            <td>—</td><td>—</td><td className="indicator-column"><AccountIndicator role={row.actor} /></td><td><span className="store-registry-secondary">بدون متجر</span></td><td>—</td><td>—</td>
          </tr>)}</tbody>
        </table></div>
        <ul className="store-registry-mobile" aria-label="الشركاء والمتاجر">{rows.map((row) => <li key={row.kind === "store" ? row.store.id : row.actor.actorId}>
          {row.kind === "store" ? <>
            <div className="store-mobile-heading"><input type="checkbox" aria-label={`تحديد متجر ${row.store.name}`} checked={selectedIds.has(row.store.id)} onChange={() => toggleSelected(row.store.id)} />{storeIdentity(row, true)}</div>
            <div className="store-mobile-facts">{storeLocation(row.store)}<span>{row.store.primaryVerticalName || "—"}{row.store.commercialStoreTypeNameAr ? ` · ${row.store.commercialStoreTypeNameAr}` : ""}</span></div>
            <div className="store-mobile-status"><span><AccountIndicator role={row.partnerRole} /><PublicationIndicator state={row.store.publicationState} /><FulfillmentIndicators modes={row.store.fulfillmentModes} /></span><time dateTime={row.store.updatedAt}>{new Intl.DateTimeFormat("ar-YE", { dateStyle: "short" }).format(new Date(row.store.updatedAt))}</time></div>
          </> : <><Link href={`/partners/actors/${encodeURIComponent(row.actor.actorId)}`}><bdi dir="ltr">{row.actor.phoneE164}</bdi></Link><span className="store-registry-secondary">شريك دون متجر</span><AccountIndicator role={row.actor} /></>}
        </li>)}</ul>

      </> : null}
      <footer className="registry-footer"><StoreIndicatorLegend /><CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات الشركاء والمتاجر" /></footer>
    </section>
  );
}
