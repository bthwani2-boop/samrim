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
  const [cities, setCities] = useState<ReadonlyArray<{ id: string; displayNameAr: string }>>([]);
  const ownerState = (role: ActorRoleView | null): string => !role ? "غير متاحة" : !role.enabled ? "موقوف" : !role.activatedAt ? "بانتظار التفعيل" : "نشط";
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
    // Private history-only navigation increments the revision to request a fresh canonical page.
    if (cursorPage.ready && navigationVersion >= 0) void load();
    return () => { requestSequence.current += 1; };
  }, [load, cursorPage.ready, navigationVersion]);
  useEffect(() => {
    if (!cursorPage.ready) return;
    let lastCheck = Date.now();
    const revalidate = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < 30_000) return;
      lastCheck = Date.now();
      void load();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") { lastCheck = Date.now(); void load(); }
    }, 120_000);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", revalidate); window.removeEventListener("focus", revalidate); };
  }, [cursorPage.ready, load]);

  return (
    <section className="workspace-page store-registry" aria-labelledby="store-registry-title">
      <PageHeader id="store-registry-title" title="الشركاء والمتاجر" />

      {inspectId ? <StoreInspector key={inspectId} storeId={inspectId} detailHref={storeHref(inspectId)} onClose={closeInspector} /> : null}

      <div className="workspace-toolbar store-registry-toolbar">
        <search className="store-registry-search" aria-label="البحث في الشركاء والمتاجر">
          <form className="store-registry-search-form" noValidate onSubmit={(event) => { event.preventDefault(); navigate(filter, search.trim().slice(0, 100), sort); }}>
            <label className="field-label" htmlFor="partner-store-search">اسم المتجر أو الشريك أو هاتفه<input id="partner-store-search" type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="الاسم أو رقم الهاتف" /></label>
            <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          </form>
        </search>
        <label className="field-label" htmlFor="partner-registry-mode">عرض السجل<select id="partner-registry-mode" value={mode} onChange={(event) => navigate(event.target.value === "without_store" ? "" : filter, appliedSearch, sort, event.target.value, event.target.value === "without_store" ? "" : serviceCityId)} disabled={loading}><option value="all">الشركاء والمتاجر</option><option value="stores">المتاجر فقط</option><option value="without_store">شركاء دون متاجر</option></select></label>
        <label className="field-label" htmlFor="partner-store-publication-filter">حالة النشر<select id="partner-store-publication-filter" value={filter} onChange={(event) => navigate(event.target.value, appliedSearch, sort)} disabled={loading || mode === "without_store"}>{publicationFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="field-label" htmlFor="partner-registry-city">المدينة<select id="partner-registry-city" value={serviceCityId} onChange={(event) => navigate(filter, appliedSearch, sort, mode, event.target.value)} disabled={loading || mode === "without_store"}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="partner-store-sort">ترتيب آخر تحديث<select id="partner-store-sort" value={sort} onChange={(event) => navigate(filter, appliedSearch, event.target.value)} disabled={loading}><option value="updated_desc">الأحدث تحديثًا</option><option value="updated_asc">الأقدم تحديثًا</option></select></label>

      </div>

      {filter || appliedSearch ? <section className="active-filter-chips" aria-label="عوامل البحث والتصفية النشطة">
        {filter ? <button type="button" className="filter-chip" onClick={() => navigate("", appliedSearch, sort)}>النشر: {publicationFilters.find((option) => option.value === filter)?.label}<span aria-hidden="true">×</span><span className="visually-hidden">مسح تصفية النشر</span></button> : null}
        {appliedSearch ? <button type="button" className="filter-chip" onClick={() => navigate(filter, "", sort)}>البحث: {appliedSearch}<span aria-hidden="true">×</span><span className="visually-hidden">مسح البحث</span></button> : null}
        <button type="button" className="button button-secondary" onClick={() => navigate("", "", "updated_desc")}>مسح الكل</button>
      </section> : null}

      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة الشركاء والمتاجر</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
      {loading && rows.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة الشركاء والمتاجر</strong></div> : null}
      {!loading && !error && rows.length === 0 ? <div className="collection-state"><strong>{nextCursor ? "لا توجد سجلات مطابقة في هذا الجزء من النتائج" : "لا توجد نتائج مطابقة"}</strong><p>{nextCursor ? "يمكن الانتقال إلى الصفحة التالية للمتابعة دون تحميل كامل السجل." : "غيّر عوامل البحث أو امسحها."}</p></div> : null}

      {rows.length > 0 ? <>
        <div className="partner-registry-summary"><span>الصفحة الحالية · {rows.length} سجلًا</span><fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات المتاجر المحددة</legend><span aria-live="polite">المحدد: {selectedOnPage}</span><button type="button" className="button button-secondary" onClick={exportSelected} disabled={selectedOnPage === 0}>تصدير المحدد</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={selectedOnPage === 0}>إلغاء التحديد</button></fieldset></div>
        <div className="store-registry-table-wrap"><table className="operations-table partner-registry-table">
          <caption className="visually-hidden">سجل موحد يعرض صفًا لكل متجر، وصفًا للشريك الذي لا يملك متجرًا، مع عرض حالة حسابه</caption>
          <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input aria-label={allSelected ? "إلغاء تحديد كل المتاجر" : "تحديد كل المتاجر في الصفحة"} type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(stores.map((store) => store.id)) : new Set())} /></th><th scope="col">الشريك / المتجر</th><th scope="col">مدينة الخدمة</th><th scope="col">النشاط الرئيسي</th><th scope="col">حالة الحساب</th><th scope="col">النشر</th><th scope="col">أوضاع الطلب</th><th scope="col">آخر تحديث</th></tr></thead>
          <tbody>{rows.map((row) => row.kind === "store" ? <tr key={row.store.id}>
            <td><input type="checkbox" aria-label={`تحديد متجر ${row.store.name}`} checked={selectedIds.has(row.store.id)} onChange={() => toggleSelected(row.store.id)} /></td>
            <th scope="row">
              <div className="store-registry-identity">
                <StoreLogo name={row.store.name} uri={row.store.storeProfileImage?.uri} />
                <div className="store-registry-identity-copy">
                  <div className="action-row store-registry-name"><Link href={storeHref(row.store.id)}>{row.store.name}</Link><button id={`store-inspection-${row.store.id}`} className="store-registry-inspect-button" type="button" title="معاينة المتجر" aria-label={`معاينة متجر ${row.store.name}`} onClick={() => inspectStore(row.store.id)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2.5 12s3.6-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.6 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg></button></div>
                  <div className="store-registry-owner"><Link href={`/partners/actors/${encodeURIComponent(row.store.partnerActorId)}`}>{row.store.partnerName && row.store.partnerName !== row.store.name ? row.store.partnerName : "ملف الشريك"}</Link></div>
                  {row.partnerRole?.phoneE164 ? <a className="store-registry-secondary" href={`tel:${row.partnerRole.phoneE164}`}><bdi dir="ltr">{row.partnerRole.phoneE164}</bdi></a> : null}
                </div>
              </div>
            </th>
            <td><div className="store-registry-cell-stack"><span>{row.store.serviceCityName || "غير محددة"}</span>{row.store.deliveryOrigin ? <a href={`https://www.google.com/maps?q=${row.store.deliveryOrigin.latitude},${row.store.deliveryOrigin.longitude}`} target="_blank" rel="noopener noreferrer" aria-label={`موقع متجر ${row.store.name} على الخريطة`}>عرض الموقع ↗</a> : null}</div></td>
            <td><div className="store-registry-cell-stack"><span>{row.store.primaryVerticalName || "غير محددة"}</span><span className="store-registry-secondary">{row.store.commercialStoreTypeNameAr || "نوع المتجر غير محدد"}</span></div></td>
            <td><span className="store-registry-state" data-state={row.partnerRole?.enabled === false ? "warning" : row.partnerRole?.activatedAt ? "success" : "neutral"}><span aria-hidden="true">{row.partnerRole?.activatedAt && row.partnerRole.enabled ? "✓" : "○"}</span>{ownerState(row.partnerRole)}</span></td>
            <td><span className="store-registry-state" data-state={row.store.publicationState === "published" ? "success" : "neutral"}><span aria-hidden="true">{row.store.publicationState === "published" ? "✓" : "○"}</span>{publicationStateLabel(row.store.publicationState)}</span></td>
            <td>{row.store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"}</td>
            <td><time dateTime={row.store.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.store.updatedAt))}</time></td>
          </tr> : <tr key={`partner-${row.actor.actorId}`}>
            <td aria-label="حساب بلا متجر">—</td>
            <th scope="row"><Link href={`/partners/actors/${encodeURIComponent(row.actor.actorId)}`}><bdi dir="ltr">{row.actor.phoneE164}</bdi></Link><div className="store-registry-owner">شريك دون متجر</div></th>
            <td>—</td><td>—</td><td>{ownerState(row.actor)}</td><td>بدون متجر</td><td>—</td><td>—</td>
          </tr>)}</tbody>
        </table></div>

      </> : null}
      <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات الشركاء والمتاجر" />
    </section>
  );
}
