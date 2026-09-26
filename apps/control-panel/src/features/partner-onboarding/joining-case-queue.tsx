"use client";

import { type JoiningCaseListResponse, joiningCaseStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { downloadRegistryCsv } from "./registry-csv";
import "./partner-directory.module.css";
import "./joining-case-queue.module.css";

type QueueState = "" | "draft" | "admission_requested" | "submitted" | "needs_correction" | "approved";
type QueueSort = "created_asc" | "created_desc";
type QueueHistory = Readonly<{ joiningCaseCursors?: ReadonlyArray<string> }>;
const pageSize = 10;
const stateOptions: ReadonlyArray<{ value: QueueState; label: string }> = [
  { value: "", label: "كل الحالات" },
  { value: "draft", label: "مسودة" },
  { value: "admission_requested", label: "بانتظار قبول المشغّل" },
  { value: "submitted", label: "مقدمة للمراجعة" },
  { value: "needs_correction", label: "تحتاج تصحيحًا" },
  { value: "approved", label: "معتمدة" },
];

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
    const query = params.toString();
    window.history.pushState({ joiningCaseCursors: pageCursors }, "", window.location.pathname + (query ? `?${query}` : ""));
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
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as JoiningCaseListResponse;
      if (sequence !== requestSequence.current) return;
      setCases(page.cases);
      setNextCursor(page.nextCursor ?? "");
      setSelectedIds(new Set());
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذر قراءة طابور حالات الانضمام.");
      setCases([]);
      setNextCursor("");
      setSelectedIds(new Set());
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [appliedQuery, cursor, sort, state]);

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

  function exportSelected() {
    if (!selectedCases.length) return;
    downloadRegistryCsv("joining-case-selection.csv", ["معرّف الطلب", "الشريك", "الهاتف", "متجر الانضمام", "الحالة", "آخر تحديث"], selectedCases.map((item) => [item.id, item.businessName, item.contactPhoneE164, item.firstStoreName, joiningCaseStateLabel(item.state), item.updatedAt]));
  }

  return <section className="joining-case-queue" aria-label="طابور طلبات انضمام الشركاء">
    <div className="joining-case-queue-toolbar">
      <search className="joining-case-queue-search" aria-label="البحث في طلبات الانضمام"><form onSubmit={(event) => { event.preventDefault(); navigate(state, query.trim().slice(0, 128), sort); }}><label className="field-label" htmlFor="joining-case-search">الطلب أو الهاتف أو المتجر<input id="joining-case-search" type="search" value={query} maxLength={128} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو رقم الهاتف" /></label><button type="submit" className="button button-secondary" disabled={busy}>بحث</button></form></search>
      <label className="field-label" htmlFor="joining-case-state">حالة الطلب<select id="joining-case-state" value={state} onChange={(event) => navigate(event.target.value as QueueState, appliedQuery, sort)} disabled={busy}>{stateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="field-label" htmlFor="joining-case-sort">ترتيب الإنشاء<select id="joining-case-sort" value={sort} onChange={(event) => navigate(state, appliedQuery, event.target.value as QueueSort)} disabled={busy}><option value="created_asc">الأقدم أولًا</option><option value="created_desc">الأحدث أولًا</option></select></label>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void loadQueue()}>{busy ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
    </div>

    {state || appliedQuery ? <section className="partner-active-filters" aria-label="التصفية النشطة">{state ? <button type="button" className="filter-chip" onClick={() => navigate("", appliedQuery, sort)}>الحالة: {stateOptions.find((option) => option.value === state)?.label}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح تصفية الحالة</span></button> : null}{appliedQuery ? <button type="button" className="filter-chip" onClick={() => navigate(state, "", sort)}>البحث: {appliedQuery}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح البحث</span></button> : null}<button type="button" className="button button-secondary" onClick={() => navigate("", "", "created_asc")}>مسح الكل</button></section> : null}
    {busy && cases.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تحميل حالات DSH</strong></div> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة طابور الانضمام</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => void loadQueue()}>إعادة المحاولة</button></div> : null}
    {!busy && !error && cases.length === 0 ? <div className="collection-state"><strong>لا توجد حالات مطابقة</strong><p>غيّر حالة الطلب أو امسح التصفية.</p></div> : null}

    {cases.length > 0 ? <>
      <div className="partner-registry-summary"><span>الصفحة الحالية · {cases.length} طلبات</span><fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات الطلبات المحددة</legend><span aria-live="polite">المحدد: {selectedCases.length}</span><button type="button" className="button button-secondary" onClick={exportSelected} disabled={selectedCases.length === 0}>تصدير المحدد CSV</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={selectedCases.length === 0}>إلغاء التحديد</button></fieldset></div>
      <div className="joining-case-table-wrap" aria-busy={busy}><table className="operations-table partner-registry-table">
        <caption className="visually-hidden">حالات انضمام الشركاء من DSH</caption>
        <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input type="checkbox" aria-label={allSelected ? "إلغاء تحديد كل الطلبات" : "تحديد كل الطلبات في الصفحة"} checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(cases.map((item) => item.id)) : new Set())} /></th><th scope="col">الشريك</th><th scope="col">الهاتف</th><th scope="col">متجر الانضمام</th><th scope="col">الحالة</th><th scope="col">آخر تحديث</th><th scope="col">الإجراء</th></tr></thead>
        <tbody>{cases.map((item) => <tr key={item.id}><td><input type="checkbox" aria-label={`تحديد طلب ${item.businessName}`} checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} /></td><th scope="row">{item.businessName}</th><td><bdi dir="ltr">{item.contactPhoneE164}</bdi></td><td>{item.firstStoreName}</td><td>{joiningCaseStateLabel(item.state)}</td><td><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.updatedAt))}</time></td><td><Link className="partner-row-action" href={`/partners/${encodeURIComponent(item.id)}`}>فتح الحالة <span aria-hidden="true">←</span></Link></td></tr>)}</tbody>
      </table></div>
        <nav className="partner-registry-pagination" aria-label="صفحات طلبات الانضمام"><button type="button" className="button button-secondary" disabled={busy || cursorStack.length === 0} onClick={() => navigate(state, appliedQuery, sort, cursorStack.at(-1) ?? "", cursorStack.slice(0, -1))}>السابق</button><span>{cursorStack.length + 1}</span><button type="button" className="button button-secondary" disabled={busy || !nextCursor} onClick={() => navigate(state, appliedQuery, sort, nextCursor, [...cursorStack, cursor])}>التالي</button></nav>
    </> : null}
  </section>;
}
