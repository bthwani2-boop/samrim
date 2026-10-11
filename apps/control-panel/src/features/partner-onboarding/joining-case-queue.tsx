"use client";

import { type JoiningCaseListResponse, type JoiningCaseState, joiningCaseStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { downloadRegistryCsv } from "./registry-csv";
import "./partner-directory.module.css";
import "./joining-case-queue.module.css";

type QueueState = "" | JoiningCaseState;
type QueueSort = "created_asc" | "created_desc";
type QueueHistory = Readonly<{ joiningCaseCursors?: ReadonlyArray<string> }>;
const pageSize = 25;
const stateOptions: ReadonlyArray<{ value: QueueState; label: string }> = [
  { value: "", label: "كل الطلبات" },
  { value: "submitted", label: "للمراجعة" },
  { value: "admission_requested", label: "بانتظار القبول" },
  { value: "needs_correction", label: "تحتاج تصحيحًا" },
  { value: "draft", label: "المسودات" },
  { value: "approved", label: "المعتمدة" },
];

function caseAction(state: JoiningCaseState): string {
  switch (state) {
    case "submitted": return "مراجعة الطلب";
    case "admission_requested": return "مراجعة القبول";
    case "needs_correction": return "عرض التصحيح";
    case "approved": return "متابعة الطلب";
    default: return "عرض المسودة";
  }
}

function caseHint(state: JoiningCaseState): string {
  switch (state) {
    case "submitted": return "بانتظار قرار المراجعة";
    case "admission_requested": return "بانتظار قبول المشغّل";
    case "needs_correction": return "بانتظار استكمال صاحب الطلب";
    case "approved": return "تابع جاهزية المتجر من الملف";
    default: return "لم تُرسل للمراجعة";
  }
}

const dateFormatter = new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" });

export function JoiningCaseQueue() {
  const [cases, setCases] = useState<JoiningCaseListResponse["cases"]>([]);
  const [state, setState] = useState<QueueState>("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [sort, setSort] = useState<QueueSort>("created_asc");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const requestSequence = useRef(0);

  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get("state") ?? "";
    const requestedQuery = params.get("q")?.trim().slice(0, 128) ?? "";
    const requestedSort = params.get("sort");
    const historyState = window.history.state as QueueHistory | null;
    setState(stateOptions.some((item) => item.value === requestedState) ? requestedState as QueueState : "");
    setQuery(requestedQuery);
    setAppliedQuery(requestedQuery);
    setSort(requestedSort === "created_desc" ? "created_desc" : "created_asc");
    setCursor(params.get("cursor") ?? "");
    setCursorStack(historyState?.joiningCaseCursors ?? []);
    setSelectedIds(new Set());
    setNotice("");
  }, []);

  useEffect(() => {
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  const navigate = useCallback((nextState: QueueState, nextQuery: string, nextSort: QueueSort, pageCursor = "", pageCursors: ReadonlyArray<string> = []) => {
    const params = new URLSearchParams(window.location.search);
    if (nextState) params.set("state", nextState); else params.delete("state");
    if (nextQuery) params.set("q", nextQuery); else params.delete("q");
    if (nextSort !== "created_asc") params.set("sort", nextSort); else params.delete("sort");
    if (pageCursor) params.set("cursor", pageCursor); else params.delete("cursor");
    const search = params.toString();
    window.history.pushState({ joiningCaseCursors: pageCursors }, "", window.location.pathname + (search ? `?${search}` : ""));
    setNotice("");
    setState(nextState);
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setSort(nextSort);
    setCursor(pageCursor);
    setCursorStack(pageCursors);
    setSelectedIds(new Set());
  }, []);

  const loadQueue = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(pageSize), sort });
      if (state) params.set("state", state);
      if (appliedQuery) params.set("q", appliedQuery);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/partners/joining-cases?${params.toString()}`, { cache: "no-store" });
      if (sequence !== requestSequence.current) return;
      if (response.status === 400 && cursor) {
        navigate(state, appliedQuery, sort);
        setNotice("انتهت صلاحية الصفحة السابقة؛ عدنا إلى أول صفحة مع الاحتفاظ بالبحث والمرشحات.");
        return;
      }
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as JoiningCaseListResponse;
      if (sequence !== requestSequence.current) return;
      setCases(page.cases);
      setNextCursor(page.nextCursor ?? "");
      setSelectedIds(new Set());
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذر قراءة طلبات الانضمام.");
      setCases([]);
      setNextCursor("");
      setSelectedIds(new Set());
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [appliedQuery, cursor, navigate, sort, state]);

  useEffect(() => { if (urlReady) void loadQueue(); }, [loadQueue, urlReady]);

  function toggleSelected(caseId: string) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (updated.has(caseId)) updated.delete(caseId); else updated.add(caseId);
      return updated;
    });
  }

  const selectedCases = cases.filter((item) => selectedIds.has(item.id));
  const allSelected = cases.length > 0 && selectedCases.length === cases.length;
  const isFiltered = Boolean(state || appliedQuery);
  const currentFilterLabel = stateOptions.find((option) => option.value === state)?.label ?? "كل الطلبات";

  function exportSelected() {
    if (!selectedCases.length) return;
    downloadRegistryCsv("joining-case-selection.csv", ["الشريك", "الهاتف", "متجر الانضمام", "الحالة", "آخر تحديث"], selectedCases.map((item) => [item.businessName, item.contactPhoneE164, item.firstStoreName, joiningCaseStateLabel(item.state), item.updatedAt]));
  }

  return <section className="joining-case-queue" aria-label="طابور طلبات انضمام الشركاء">
    <nav className="joining-case-status-nav" aria-label="تصفية طلبات الانضمام حسب المرحلة">
      {stateOptions.map((option) => <button key={option.value || "all"} type="button" className={state === option.value ? "joining-case-status-tab is-active" : "joining-case-status-tab"} aria-pressed={state === option.value} onClick={() => navigate(option.value, appliedQuery, sort)}>{option.label}</button>)}
    </nav>

    <div className="joining-case-queue-toolbar">
      <search className="joining-case-queue-search" aria-label="البحث في طلبات الانضمام">
        <form noValidate onSubmit={(event) => { event.preventDefault(); navigate(state, query.trim().slice(0, 128), sort); }}>
          <label className="field-label" htmlFor="joining-case-search">ابحث عن طلب<input id="joining-case-search" type="search" value={query} maxLength={128} onChange={(event) => setQuery(event.target.value)} placeholder="اسم الشريك أو المتجر أو رقم الهاتف" /></label>
          <button type="submit" className="button button-primary" disabled={busy}>بحث</button>
        </form>
      </search>
      <label className="field-label" htmlFor="joining-case-sort">الترتيب<select id="joining-case-sort" value={sort} onChange={(event) => navigate(state, appliedQuery, event.target.value as QueueSort)} disabled={busy}><option value="created_asc">الأقدم أولًا</option><option value="created_desc">الأحدث أولًا</option></select></label>
      <button type="button" className="button button-secondary joining-case-refresh" disabled={busy} onClick={() => void loadQueue()}>{busy ? "جارٍ التحديث…" : "تحديث"}</button>
    </div>

    {isFiltered ? <section className="partner-active-filters" aria-label="المرشحات النشطة">
      {state ? <button type="button" className="filter-chip" onClick={() => navigate("", appliedQuery, sort)}>الحالة: {currentFilterLabel}<span aria-hidden="true"> ×</span></button> : null}
      {appliedQuery ? <button type="button" className="filter-chip" onClick={() => navigate(state, "", sort)}>البحث: <bdi>{appliedQuery}</bdi><span aria-hidden="true"> ×</span></button> : null}
      <button type="button" className="button button-secondary" onClick={() => navigate("", "", sort)}>مسح المرشحات</button>
    </section> : null}
    {busy && cases.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تحميل الطلبات…</strong></div> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة طلبات الانضمام</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => void loadQueue()}>إعادة المحاولة</button></div> : null}
    {notice ? <p className="joining-case-notice" role="status">{notice}</p> : null}
    {!busy && !error && cases.length === 0 ? <div className="collection-state"><strong>{isFiltered ? "لا توجد طلبات مطابقة" : "لا توجد طلبات حتى الآن"}</strong><p>{isFiltered ? "جرّب بحثًا مختلفًا أو امسح المرشحات." : "ستظهر طلبات الانضمام هنا عند تسجيلها."}</p></div> : null}

    {cases.length > 0 ? <>
      <div className="joining-case-queue-summary">
        <div className="joining-case-queue-summary-copy"><strong>{currentFilterLabel}</strong><span>المعروض في هذه الصفحة: {cases.length} طلبًا{nextCursor ? " · توجد صفحة تالية" : ""}</span>{busy ? <span role="status">جارٍ تحديث النتائج…</span> : null}</div>
        {selectedCases.length > 0 ? <fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات الطلبات المحددة في الصفحة</legend><span aria-live="polite">{selectedCases.length} محدد</span><button type="button" className="button button-secondary" onClick={exportSelected}>تصدير المحدد</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</button></fieldset> : null}
      </div>
      <div className="joining-case-table-wrap" aria-busy={busy}>
        <table className="operations-table joining-case-table">
          <caption className="visually-hidden">طلبات الانضمام المعروضة في الصفحة الحالية، مع نوع المصدر والحالة والإجراء المناسب</caption>
          <thead><tr>
            <th scope="col"><input type="checkbox" aria-label={allSelected ? "إلغاء تحديد كل الطلبات في الصفحة" : "تحديد كل الطلبات في الصفحة"} checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(cases.map((item) => item.id)) : new Set())} /></th>
            <th scope="col">الشريك / الهاتف</th>
            <th scope="col">المتجر / المصدر</th>
            <th scope="col">الحالة والخطوة التالية</th>
            <th scope="col">آخر تحديث</th>
            <th scope="col">الإجراء</th>
          </tr></thead>
          <tbody>{cases.map((item) => <tr key={item.id}>
            <td><input type="checkbox" aria-label={`تحديد طلب ${item.businessName}`} checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} /></td>
            <th scope="row"><div className="joining-case-row-main"><span>{item.businessName}</span><bdi dir="ltr">{item.contactPhoneE164}</bdi></div></th>
            <td><div className="joining-case-row-main"><span>{item.firstStoreName || "متجر بدون اسم"}</span><small>{item.origin === "field" ? "عبر الميداني" : "عبر لوحة التحكم"}</small></div></td>
            <td><div className="joining-case-row-state"><span className={`joining-case-state-pill state-${item.state}`}>{joiningCaseStateLabel(item.state)}</span><small>{caseHint(item.state)}</small></div></td>
            <td><time dateTime={item.updatedAt}>{dateFormatter.format(new Date(item.updatedAt))}</time></td>
            <td><Link className="partner-row-action joining-case-row-action" href={`/partners/${encodeURIComponent(item.id)}`}>{caseAction(item.state)}<span aria-hidden="true">←</span></Link></td>
          </tr>)}</tbody>
        </table>
      </div>
      <nav className="partner-registry-pagination joining-case-pagination" aria-label="صفحات طلبات الانضمام">
        <button type="button" className="button button-secondary" disabled={busy || cursorStack.length === 0} onClick={() => navigate(state, appliedQuery, sort, cursorStack.at(-1) ?? "", cursorStack.slice(0, -1))}>السابق</button>
        <span aria-current="page">الصفحة {cursorStack.length + 1}</span>
        <button type="button" className="button button-secondary" disabled={busy || !nextCursor} onClick={() => navigate(state, appliedQuery, sort, nextCursor, [...cursorStack, cursor])}>التالي</button>
      </nav>
    </> : null}
  </section>;
}
