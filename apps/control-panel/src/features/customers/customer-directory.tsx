"use client";


import type { ActorRoleSearchPage, ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { CustomerProfile } from "./customer-profile";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { customerPageCounts, customerStateLabel as customerStatus } from "./customer-directory-page-counts";

const pageSize = 20;
const dateText = (value?: string) => value ? new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium" }).format(new Date(value)) : "لم يُسجّل";

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message || "تعذرت قراءة سجل العملاء.";
}

export function CustomerDirectory() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [securityFilter, setSecurityFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [pageSort, setPageSort] = useState("default");
  const [items, setItems] = useState<ReadonlyArray<ActorRoleView>>([]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const visibleItems = items.filter((customer) =>
    (securityFilter === "all" || (securityFilter === "blocked" ? !customer.securityEnabled : customer.securityEnabled))
    && (activityFilter === "all" || (activityFilter === "opened" ? Boolean(customer.lastAppOpenedAt ?? customer.lastAuthenticatedAt) : !customer.lastAppOpenedAt && !customer.lastAuthenticatedAt))
  ).sort((a,b) => {
    if (pageSort === "default") return 0;
    const left = a.createdAt ? Date.parse(a.createdAt) : 0;
    const right = b.createdAt ? Date.parse(b.createdAt) : 0;
    return (pageSort === "oldest" ? 1 : -1) * (left - right);
  });
  const pageFiltersActive = securityFilter !== "all" || activityFilter !== "all" || pageSort !== "default";
  const visibleCounts = customerPageCounts(visibleItems);
  const requestId = useRef(0);

  const navigate = useCallback((q: string, enabled: string, pageCursor = "", stack: string[] = []) => {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    if (enabled) url.searchParams.set("enabled", enabled); else url.searchParams.delete("enabled");
    if (pageCursor) url.searchParams.set("cursor", pageCursor); else url.searchParams.delete("cursor");
    window.history.pushState({ ...window.history.state, customerPageHistory: stack }, "", url.pathname + url.search);
    setQuery(q); setSearch(q); setState(enabled); setCursor(pageCursor); setHistory(stack);
  }, []);

  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q")?.slice(0, 100) ?? "";
      const status = params.get("enabled") ?? "";
      setSelectedCustomer(params.get("customer")?.slice(0, 160) ?? "");
      setQuery(q); setSearch(q); setState(["", "true", "false"].includes(status) ? status : "");
      setCursor(params.get("cursor") ?? "");
      const stored = window.history.state?.customerPageHistory;
      setHistory(Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : []);
    };
    sync(); setReady(true);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit refresh generation for this canonical paged read.
  useEffect(() => {
    if (!ready) return;
    const sequence = ++requestId.current;
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: String(pageSize), q: query });
    if (state) params.set("enabled", state);
    if (cursor) params.set("cursor", cursor);
    void (async () => {
      try {
        const response = await identityFetch(`/api/customers?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await responseError(response));
        const result = await response.json() as ActorRoleSearchPage;
        if (controller.signal.aborted || sequence !== requestId.current) return;
        setItems(result.items); setNext(result.nextCursor ?? "");
      } catch (cause) {
        if (controller.signal.aborted || sequence !== requestId.current) return;
        setItems([]); setNext("");
        setError(cause instanceof Error ? cause.message : "تعذرت قراءة العملاء.");
      } finally { if (!controller.signal.aborted && sequence === requestId.current) setLoading(false); }
    })();
    return () => controller.abort();
  }, [query, state, cursor, ready, revision]);

  useReadOnReturn(() => setRevision((value) => value + 1), ready && !loading && !selectedCustomer);

  const selectCustomer = (actorId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("customer", actorId);
    window.history.pushState({ ...window.history.state }, "", url.pathname + url.search + url.hash);
    setSelectedCustomer(actorId);
  };
  const closeCustomer = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("customer");
    url.searchParams.delete("tab");
    window.history.pushState({ ...window.history.state }, "", url.pathname + url.search + url.hash);
    setSelectedCustomer("");
  };
  const selectedIndex = items.findIndex((item) => item.actorId === selectedCustomer);
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const moveSelection = (offset: number) => {
    const nextItem = items[selectedIndex + offset];
    if (nextItem) selectCustomer(nextItem.actorId);
  };

  return <AdaptiveRecordWorkspace preferenceKey="customers" open={Boolean(selectedCustomer)} onClose={closeCustomer}
    detail={<AdaptiveRecordPanel title="ملف العميل"
      onClose={closeCustomer} onPrevious={selectedIndex > 0 ? () => moveSelection(-1) : undefined}
      onNext={selectedIndex >= 0 && selectedIndex < items.length - 1 ? () => moveSelection(1) : undefined}>
      {selectedCustomer ? <CustomerProfile key={selectedCustomer} actorId={selectedCustomer} embedded /> : null}
    </AdaptiveRecordPanel>}>
  <div className="customer-directory">
    <div className="customer-directory-toolbar">
      <form className="customer-search-form" noValidate onSubmit={(event) => {
        event.preventDefault(); navigate(search.trim(), state);
      }}>
        <label htmlFor="customer-search">بحث العملاء</label>
        <div><input id="customer-search" type="search" autoComplete="off" placeholder="رقم الهاتف أو معرف العميل" maxLength={100}
          value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="button button-primary">بحث</button></div>
      </form>
      <label className="customer-state-filter" htmlFor="customer-state">الحساب
        <select id="customer-state" value={state} onChange={(event) => navigate(query, event.target.value)}>
          <option value="">جميع الحالات</option><option value="true">نشط</option><option value="false">موقوف</option>
        </select>
      </label>

      {query || state ? <button type="button" className="button button-secondary" onClick={() => navigate("", "")}>مسح التصفية</button> : null}
    </div>
    <div className="customer-directory-heading"><div><h2>سجل العملاء</h2><p>البيانات المباشرة من نظام الهوية · الصفحة الحالية {items.length} عميلًا</p></div>
      <span className="customer-section-note">كل عميل له ملف موحد</span></div>
    {!loading && !error && items.length > 0 ? <section aria-label="حالات العملاء المعروضين في الصفحة الحالية">
      <p className="customer-section-note">هذه الأعداد تخص نتائج الصفحة الحالية بعد التصفية فقط، وليست إجمالي عملاء المنصة.</p>
      <div className="customer-metric-grid">
        <div className="customer-metric"><span>المعروضون</span><strong>{visibleCounts.total.toLocaleString("ar-YE")}</strong></div>
        <div className="customer-metric"><span>نشط</span><strong>{visibleCounts.active.toLocaleString("ar-YE")}</strong></div>
        <div className="customer-metric"><span>موقوف</span><strong>{visibleCounts.suspended.toLocaleString("ar-YE")}</strong></div>
        <div className="customer-metric"><span>محظور أمنيًا</span><strong>{visibleCounts.blocked.toLocaleString("ar-YE")}</strong></div>
      </div>
    </section> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert">{error}
      <button type="button" className="button button-secondary" onClick={() => setRevision((v) => v + 1)}>إعادة المحاولة</button></div> : null}
    {loading && !items.length ? <div role="status" className="collection-state">جارٍ تحميل العملاء…</div> : null}
    {!loading && !error && !items.length ? <div className="collection-state"><strong>لا توجد حسابات مطابقة</strong><p>غيّر البحث أو الحالة.</p></div> : null}
    {pageFiltersActive && items.length > 0 ? <p className="access-center-scope">معروض من الصفحة: {visibleItems.length} من {items.length} · مرشحات الأعمدة المحلية تخص الصفحة الحالية.</p> : null}
    {items.length > 0 ? <div className="customer-directory-table-wrap"><table className="operations-table customer-directory-table">
      <thead><tr>
        <RegistryColumnHeader label="العميل" active={Boolean(query)}>
          <form onSubmit={(event) => { event.preventDefault(); navigate(search.trim(), state); }}>
            <label>رقم الهاتف أو معرف العميل<input type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <button type="submit">بحث</button>
          </form>
        </RegistryColumnHeader>
        <RegistryColumnHeader label="الحساب" active={Boolean(state || securityFilter !== "all")}>
          <label>حالة الحساب<select value={state} onChange={(event) => navigate(query, event.target.value)}>
            <option value="">جميع الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option>
          </select></label>
          <label>الحظر الأمني · الصفحة الحالية<select value={securityFilter} onChange={(event) => setSecurityFilter(event.target.value)}>
            <option value="all">الكل</option><option value="blocked">محظور أمنيًا</option><option value="unblocked">غير محظور</option>
          </select></label>
        </RegistryColumnHeader>
        <RegistryColumnHeader label="آخر استخدام" scope="page" active={activityFilter !== "all"}>
          <label>نشاط العميل<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
            <option value="all">الجميع</option><option value="opened">سبق استخدام التطبيق</option><option value="never">لم يُسجّل استخدام</option>
          </select></label>
        </RegistryColumnHeader>
        <RegistryColumnHeader label="تاريخ الانضمام" scope="page" active={pageSort !== "default"}>
          <label>الترتيب<select value={pageSort} onChange={(event) => setPageSort(event.target.value)}>
            <option value="default">الترتيب الأصلي</option><option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option>
          </select></label>
        </RegistryColumnHeader>
        <th scope="col">الملف</th>
      </tr></thead>
      <tbody>{visibleItems.map((item) => <tr key={item.actorId}>
        <th scope="row"><span className="customer-name-cell"><span className="customer-avatar" aria-hidden="true">ع</span>
          <span><strong>{item.fullNameAr || "عميل بثواني"}</strong><bdi dir="ltr">{item.phoneE164}</bdi></span></span></th>
        <td><span className="customer-state-pill" data-state={!item.securityEnabled || !item.enabled ? "off" : "on"}>{customerStatus(item)}</span></td>
        <td>{dateText(item.lastAppOpenedAt ?? item.lastAuthenticatedAt)}</td>
        <td>{dateText(item.createdAt)}</td>
        <td><button type="button" className="partner-row-action" aria-label={`فتح ملف ${item.fullNameAr || item.phoneE164}`}
          onClick={() => selectCustomer(item.actorId)}>فتح الملف ←</button></td>
      </tr>)}{visibleItems.length === 0 ? <tr><td colSpan={5}>لا توجد نتائج مطابقة في هذه الصفحة.</td></tr> : null}</tbody>
    </table></div> : null}
    {items.length > 0 ? <ul className="customer-directory-cards" aria-label="العملاء في الصفحة الحالية">
      {visibleItems.map((item) => <li key={item.actorId} className="customer-directory-card">
        <div className="customer-directory-card-head">
          <div className="customer-directory-card-name"><strong>{item.fullNameAr || "عميل بثواني"}</strong><bdi dir="ltr">{item.phoneE164}</bdi></div>
          <span className="customer-state-pill" data-state={!item.securityEnabled || !item.enabled ? "off" : "on"}>{customerStatus(item)}</span>
        </div>
        <div className="customer-directory-card-meta"><span>آخر استخدام: {dateText(item.lastAppOpenedAt ?? item.lastAuthenticatedAt)}</span></div>
        <button type="button" className="button button-secondary" aria-label={"فتح ملف " + (item.fullNameAr || item.phoneE164)} onClick={() => selectCustomer(item.actorId)}>فتح الملف</button>
      </li>)}
    </ul> : null}
    {items.length || history.length ? <nav className="customer-directory-paging" aria-label="صفحات العملاء">
      <button type="button" className="button button-secondary" disabled={loading || !history.length}
        onClick={() => navigate(query, state, history.at(-1) ?? "", history.slice(0, -1))}>السابق</button>
      <span>صفحة {history.length + 1}</span>
      <button type="button" className="button button-secondary" disabled={loading || !next}
        onClick={() => navigate(query, state, next, [...history, cursor])}>التالي</button>
    </nav> : null}
  </div>
  </AdaptiveRecordWorkspace>;
}
