"use client";

import { fulfillmentModeLabel, type JoiningCaseListResponse, type OperatorStoreSummary, publicationStateLabel, type StoreAccessGrantListResponse } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { PageHeader } from "../../shell/page-header";
import { OperationalIcon } from "../../shell/workspace-icon";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { downloadRegistryCsv } from "../shared/registry-csv";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { AccountIndicator, FulfillmentIndicators, PublicationIndicator } from "./store-indicators";
import { StoreInspector } from "./store-inspector";
import { StoreLogo } from "./store-logo";
import { type PartnerAttention, PartnerAttentionMobile, PartnerAttentionRow, StoreOperationalDecision } from "./store-registry-decision";

type RegistryRow = { kind: "store"; store: OperatorStoreSummary; partnerRole: ActorRoleView | null } | { kind: "partner"; actor: ActorRoleView };
type StorePage = Readonly<{ rows: ReadonlyArray<RegistryRow>; nextCursor?: string }>;
const isPhoneQuery = (value: string) => /^\+?[\d\s-]{5,}$/.test(value) && value.replace(/\D/g, "").length >= 5;
const publicationFilters = [
  { value: "", label: "كل حالات النشر" },
  { value: "unpublished", label: "غير منشور" },
  { value: "published", label: "منشور" },
  { value: "hidden", label: "مخفي" },
] as const;

export function StoreRegistry({ embedded = false }: Readonly<{ embedded?: boolean }>) {
  const [rows, setRows] = useState<ReadonlyArray<RegistryRow>>([]);
  const [attention, setAttention] = useState<readonly PartnerAttention[]>([]);
  const [attentionError, setAttentionError] = useState("");
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
  const lastClosedInspector = useRef("");
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

  function inspectStore(id: string, rememberOrigin = true) {
    if (rememberOrigin) inspectorOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = new URLSearchParams(window.location.search); next.set("inspect", id);
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function closeInspector() {
    lastClosedInspector.current = inspectId;
    const next = new URLSearchParams(window.location.search); next.delete("inspect");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  useEffect(() => {
    if (inspectId || !lastClosedInspector.current) return;
    const closedId = lastClosedInspector.current;
    lastClosedInspector.current = "";
    // Wait for the native dialog to unmount before returning focus to its row.
    const frame = requestAnimationFrame(() => {
      const trigger = inspectorOrigin.current?.isConnected ? inspectorOrigin.current :
        [document.getElementById(`store-inspection-${closedId}`), document.getElementById(`store-inspection-${closedId}-mobile`)].find((element) => element && element.getClientRects().length > 0);
      (trigger ?? document.getElementById("partner-store-search"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [inspectId]);

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

  // The first unfiltered page includes a bounded set of authorized urgent work.
  // These are not global totals and are never used to page the store registry.
  useEffect(() => {
    if (mode !== "all" || cursor || filter || appliedSearch || serviceCityId) {
      setAttention([]);
      setAttentionError("");
      return;
    }
    const controller = new AbortController();
    const loadAttention = async () => {
      const urls = [
        "/api/partners/joining-cases?state=submitted&sort=created_asc&limit=10",
        "/api/partners/store-access-admissions?limit=10",
      ];
      const result = await Promise.allSettled(urls.map(async (url) => {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        return await response.json() as unknown;
      }));
      if (controller.signal.aborted) return;
      const next: PartnerAttention[] = [];
      if (result[0]?.status === "fulfilled") {
        const cases = result[0].value as JoiningCaseListResponse;
        if (Array.isArray(cases.cases)) {
          next.push(...cases.cases.filter((item) => item.state === "submitted").map((item) => ({ kind: "joining" as const, case: item })));
        }
      }
      if (result[1]?.status === "fulfilled") {
        const grants = result[1].value as StoreAccessGrantListResponse;
        if (Array.isArray(grants.items)) {
          next.push(...grants.items.filter((item) => item.state === "pending_role_admission").map((item) => ({ kind: "access" as const, grant: item })));
        }
      }
      setAttention(next);
      setAttentionError(result.some((entry) => entry.status === "rejected") ? "تعذرت قراءة بعض الأعمال التي تحتاج متابعة؛ افتح سجل الطلبات أو الاعتمادات عند الحاجة." : "");
    };
    void loadAttention();
    return () => controller.abort();
  }, [mode, cursor, filter, appliedSearch, serviceCityId]);

  const attentionVisible = attention;
  const joiningAttentionCount = attentionVisible.filter((item) => item.kind === "joining").length;
  const accessAttentionCount = attentionVisible.filter((item) => item.kind === "access").length;
  const publishedOnPage = stores.filter((store) => store.publicationState === "published").length;
  const unpublishedOnPage = stores.length - publishedOnPage;
  const selectedOnPage = stores.filter((store) => selectedIds.has(store.id)).length;
  const allSelected = stores.length > 0 && selectedOnPage === stores.length;
  const inspectedIndex = stores.findIndex((store) => store.id === inspectId);

  function storeIdentity(row: Extract<RegistryRow, { kind: "store" }>, mobile = false) {
    return <div className="store-registry-identity">
      <StoreLogo name={row.store.name} uri={row.store.storeProfileImage?.uri} />
      <div className="store-registry-identity-copy">
        <div className="store-registry-name"><button className="store-registry-open" type="button" onClick={() => inspectStore(row.store.id)} aria-label={`فتح ملف متجر ${row.store.name}`}>{row.store.name}</button><button id={`store-inspection-${row.store.id}${mobile ? "-mobile" : ""}`} className="store-registry-inspect-button" type="button" title="معاينة المتجر" aria-label={`معاينة متجر ${row.store.name}`} onClick={() => inspectStore(row.store.id)}><OperationalIcon name="published" /></button></div>
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
    <AdaptiveRecordWorkspace open={Boolean(inspectId)} preferenceKey="partners-stores" onClose={closeInspector} detail={inspectId ? <StoreInspector key={inspectId} storeId={inspectId} onClose={closeInspector} onPrevious={inspectedIndex > 0 ? () => inspectStore(stores[inspectedIndex - 1]!.id, false) : undefined} onNext={inspectedIndex >= 0 && inspectedIndex < stores.length - 1 ? () => inspectStore(stores[inspectedIndex + 1]!.id, false) : undefined} onUpdated={() => void load()} /> : null}>
    <section className="workspace-page store-registry" data-inspecting={Boolean(inspectId)} aria-label="سجل الشركاء والمتاجر">
      {embedded ? null : <PageHeader id="store-registry-title" title="الشركاء والمتاجر" actions={<Link className="button button-primary" href="/partners/new">+ طلب انضمام جديد</Link>} />}


      {attentionVisible.length || stores.length ? <section className="partner-workbench-snapshot" aria-label="مؤشرات النتائج المعروضة فقط">
        <span className="partner-snapshot-scope">في النتائج المعروضة</span>
        {joiningAttentionCount > 0 ? <div className="partner-snapshot-card"><strong>{joiningAttentionCount}</strong><span>طلبات بانتظار المراجعة</span></div> : null}
        {accessAttentionCount > 0 ? <div className="partner-snapshot-card"><strong>{accessAttentionCount}</strong><span>اعتمادات وصول معلقة</span></div> : null}
        {unpublishedOnPage > 0 ? <div className="partner-snapshot-card"><strong>{unpublishedOnPage}</strong><span>متاجر غير منشورة</span></div> : null}
        {publishedOnPage > 0 ? <div className="partner-snapshot-card"><strong>{publishedOnPage}</strong><span>متاجر منشورة</span></div> : null}
        <span className="partner-snapshot-scope" title="الأرقام ليست إجماليات المنصة؛ مهام المتابعة مأخوذة من أول عشرة سجلات في كل مصدر."><OperationalIcon name="unknown" /><span className="visually-hidden">ليست إجماليات المنصة. مهام المتابعة من أول عشرة سجلات في كل مصدر.</span></span>
      </section> : null}
      {attentionError ? <p role="status" className="partner-attention-warning">{attentionError} <Link href="/partners/joining">طلبات الانضمام</Link></p> : null}
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
      {!loading && !error && rows.length === 0 && attentionVisible.length === 0 ? <div className="collection-state"><strong>{nextCursor ? "لا توجد سجلات مطابقة في هذا الجزء من النتائج" : "لا توجد نتائج مطابقة"}</strong><p>{nextCursor ? "يمكن الانتقال إلى الصفحة التالية للمتابعة دون تحميل كامل السجل." : "غيّر عوامل البحث أو امسحها."}</p></div> : null}

      {rows.length > 0 || attentionVisible.length > 0 ? <>
        <div className="partner-registry-summary"><span>الصفحة الحالية · {rows.length} سجلًا {loading ? "· جارٍ التحديث" : ""}</span>{selectedOnPage ? <fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات المتاجر المحددة</legend><span aria-live="polite">المحدد: {selectedOnPage}</span><button type="button" className="button button-secondary" onClick={exportSelected}>تصدير المحدد</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</button></fieldset> : null}</div>
        <div className="store-registry-table-wrap"><table className="operations-table partner-registry-table">
          <caption className="visually-hidden">سجل موحد يعرض صفًا لكل متجر، وصفًا للشريك الذي لا يملك متجرًا، مع عرض حالة حسابه</caption>
          <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input aria-label={allSelected ? "إلغاء تحديد كل المتاجر" : "تحديد كل المتاجر في الصفحة"} type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(stores.map((store) => store.id)) : new Set())} /></th><th scope="col">الشريك / المتجر</th><th scope="col">المدينة</th><th scope="col">النشاط والنوع</th><th scope="col" className="indicator-column">الحساب</th><th scope="col" className="indicator-column">النشر</th><th scope="col" className="fulfillment-column">التوصيل</th><th scope="col">الخطوة التالية</th><th scope="col">آخر تحديث</th></tr></thead>
          <tbody>{attentionVisible.map((entry) => <PartnerAttentionRow key={entry.kind === "joining" ? `joining:${entry.case.id}` : `access:${entry.grant.id}`} entry={entry} />)}{rows.map((row) => row.kind === "store" ? <tr key={row.store.id} data-kind="store" data-selected={inspectId === row.store.id ? "true" : undefined}
              tabIndex={0} aria-label={`عرض ملف متجر ${row.store.name}`}
              onClick={(event) => {
                if (event.target instanceof Element && !event.target.closest("a, button, input, label, select, textarea")) inspectStore(row.store.id);
              }}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  inspectStore(row.store.id);
                }
              }}>
            <td><input type="checkbox" aria-label={`تحديد متجر ${row.store.name}`} checked={selectedIds.has(row.store.id)} onChange={() => toggleSelected(row.store.id)} /></td>
            <th scope="row">{storeIdentity(row)}</th>
            <td>{storeLocation(row.store)}</td>
            <td><div className="store-registry-cell-stack"><span>{row.store.primaryVerticalName || "—"}</span><span className="store-registry-secondary">{row.store.commercialStoreTypeNameAr || <><span aria-hidden="true">—</span><span className="visually-hidden">نوع المتجر غير محدد</span></>}</span></div></td>
            <td className="indicator-column"><span className={`partner-state-tag ${row.partnerRole?.enabled && row.partnerRole.securityEnabled && row.partnerRole.activatedAt ? "is-active" : "is-pending"}`}>{!row.partnerRole ? "غير متاح" : !row.partnerRole.enabled || !row.partnerRole.securityEnabled ? "موقوف" : !row.partnerRole.activatedAt ? "بانتظار التفعيل" : "مفعّل"} <AccountIndicator role={row.partnerRole} /></span></td>
            <td className="indicator-column"><span className={`partner-state-tag ${row.store.publicationState === "published" ? "is-active" : row.store.publicationState === "hidden" ? "is-pending" : "is-muted"}`}>{publicationStateLabel(row.store.publicationState)} <PublicationIndicator state={row.store.publicationState} /></span></td>
            <td className="fulfillment-column"><span className="partner-fulfillment-copy"><FulfillmentIndicators modes={row.store.fulfillmentModes} /><span className="visually-hidden">{row.store.fulfillmentModes.length ? `أوضاع التوصيل: ${row.store.fulfillmentModes.map(fulfillmentModeLabel).join("، ")}` : "أوضاع التوصيل غير محددة"}</span></span></td><td><StoreOperationalDecision store={row.store} role={row.partnerRole} onInspect={() => inspectStore(row.store.id)} /></td>
            <td><time dateTime={row.store.updatedAt} className="store-registry-time">{new Intl.DateTimeFormat("ar-YE", { dateStyle: "short" }).format(new Date(row.store.updatedAt))}<small>{new Intl.DateTimeFormat("ar-YE", { timeStyle: "short" }).format(new Date(row.store.updatedAt))}</small></time></td>
          </tr> : <tr key={`partner-${row.actor.actorId}`} data-kind="partner">
            <td aria-label="حساب بلا متجر">—</td>
            <th scope="row"><Link href={`/partners/actors/${encodeURIComponent(row.actor.actorId)}`}><bdi dir="ltr">{row.actor.phoneE164}</bdi></Link><div className="store-registry-owner">شريك دون متجر</div></th>
            <td>—</td><td>—</td><td className="indicator-column"><AccountIndicator role={row.actor} /></td><td><span className="store-registry-secondary">بدون متجر</span></td><td>—</td><td><Link className="partner-row-action" href={`/partners/actors/${encodeURIComponent(row.actor.actorId)}`}>متابعة حساب الشريك ←</Link></td><td>—</td>
          </tr>)}</tbody>
        </table></div>
        <ul className="store-registry-mobile" aria-label="الشركاء والمتاجر">{attentionVisible.map((entry) => <PartnerAttentionMobile key={entry.kind === "joining" ? `joining:${entry.case.id}` : `access:${entry.grant.id}`} entry={entry} />)}{rows.map((row) => <li key={row.kind === "store" ? row.store.id : row.actor.actorId}>
          {row.kind === "store" ? <>
            <div className="store-mobile-heading"><input type="checkbox" aria-label={`تحديد متجر ${row.store.name}`} checked={selectedIds.has(row.store.id)} onChange={() => toggleSelected(row.store.id)} />{storeIdentity(row, true)}</div>
            <div className="store-mobile-facts">{storeLocation(row.store)}<span>{row.store.primaryVerticalName || "—"}{row.store.commercialStoreTypeNameAr ? ` · ${row.store.commercialStoreTypeNameAr}` : ""}</span></div>
            <div className="store-mobile-status"><span><AccountIndicator role={row.partnerRole} /><PublicationIndicator state={row.store.publicationState} /><FulfillmentIndicators modes={row.store.fulfillmentModes} /></span><time dateTime={row.store.updatedAt}>{new Intl.DateTimeFormat("ar-YE", { dateStyle: "short" }).format(new Date(row.store.updatedAt))}</time></div><StoreOperationalDecision store={row.store} role={row.partnerRole} onInspect={() => inspectStore(row.store.id)} />
          </> : <><Link href={`/partners/actors/${encodeURIComponent(row.actor.actorId)}`}><bdi dir="ltr">{row.actor.phoneE164}</bdi></Link><span className="store-registry-secondary">شريك دون متجر</span><AccountIndicator role={row.actor} /></>}
        </li>)}</ul>

      </> : null}
      <footer className="registry-footer"><CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات الشركاء والمتاجر" /></footer>
    </section>
    </AdaptiveRecordWorkspace>
  );
}
