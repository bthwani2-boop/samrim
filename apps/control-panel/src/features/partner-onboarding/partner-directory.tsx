"use client";

import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { partnerErrorMessage } from "./partner-error-message";
import { downloadRegistryCsv } from "./registry-csv";
import "./partner-directory.module.css";

type PartnerRecord = ActorRoleView;
type PartnerPage = Readonly<{ items: ReadonlyArray<PartnerRecord>; nextCursor?: string }>;
type NavigationState = Readonly<{ partnerRosterCursors?: ReadonlyArray<string> }>;
const pageSize = 10;

function rosterNavigationState(value: unknown): NavigationState {
  return value && typeof value === "object" ? value as NavigationState : {};
}

export function PartnerDirectory() {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [sort, setSort] = useState<"phone_asc" | "phone_desc">("phone_asc");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [items, setItems] = useState<ReadonlyArray<PartnerRecord>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const requestSequence = useRef(0);

  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedQuery = params.get("q")?.trim().slice(0, 100) ?? "";
    const requestedEnabled = params.get("enabled") ?? "";
    const requestedSort = params.get("sort");
    const requestedCursor = params.get("cursor") ?? "";
    const historyState = rosterNavigationState(window.history.state);
    setQuery(requestedQuery);
    setAppliedQuery(requestedQuery);
    setEnabledFilter(requestedEnabled === "true" || requestedEnabled === "false" ? requestedEnabled : "");
    setSort(requestedSort === "phone_desc" ? "phone_desc" : "phone_asc");
    setCursor(requestedCursor);
    setCursorStack(historyState.partnerRosterCursors ?? []);
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  const navigate = useCallback((state: string, queryText: string, nextSort: "phone_asc" | "phone_desc", pageCursor = "", pageCursors: ReadonlyArray<string> = []) => {
    const params = new URLSearchParams(window.location.search);
    if (state) params.set("enabled", state); else params.delete("enabled");
    if (queryText) params.set("q", queryText); else params.delete("q");
    if (nextSort !== "phone_asc") params.set("sort", nextSort); else params.delete("sort");
    if (pageCursor) params.set("cursor", pageCursor); else params.delete("cursor");
    const search = params.toString();
    window.history.pushState({ partnerRosterCursors: pageCursors }, "", window.location.pathname + (search ? `?${search}` : ""));
    setEnabledFilter(state);
    setQuery(queryText);
    setAppliedQuery(queryText);
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
      const params = new URLSearchParams({ limit: String(pageSize), q: appliedQuery, sort });
      if (cursor) params.set("cursor", cursor);
      if (enabledFilter) params.set("enabled", enabledFilter);
      const response = await identityFetch(`/api/partners/roster?${params.toString()}`);
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as PartnerPage;
      if (sequence !== requestSequence.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
      setSelectedIds(new Set());
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذر قراءة سجل الشركاء.");
      setItems([]);
      setNextCursor("");
      setSelectedIds(new Set());
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [appliedQuery, cursor, enabledFilter, sort]);

  useEffect(() => { if (urlReady) void load(); }, [load, urlReady]);

  function toggleSelected(actorId: string) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (updated.has(actorId)) updated.delete(actorId); else updated.add(actorId);
      return updated;
    });
  }

  function exportSelected() {
    const selected = items.filter((partner) => selectedIds.has(partner.actorId));
    if (!selected.length) return;
    downloadRegistryCsv("partner-registry-selection.csv", ["رقم الهاتف", "حالة الهوية الأمنية", "حالة دور الشريك", "نسخة الدور", "معرّف الحساب"], selected.map((partner) => [
        partner.phoneE164,
        partner.securityEnabled ? "نشطة" : "موقوفة",
        !partner.enabled ? "موقوف" : !partner.activatedAt ? "بانتظار التفعيل" : "نشط",
        partner.roleVersion,
        partner.actorId,
      ]));
    setNotice(`تم تصدير ${selected.length} سجلًا محددًا من الصفحة الحالية.`);
  }

  const selectedOnPage = items.filter((partner) => selectedIds.has(partner.actorId)).length;
  const allSelected = items.length > 0 && selectedOnPage === items.length;

  return <section className="partner-directory" aria-label="سجل الشركاء التشغيلي">
    <div className="partner-registry-toolbar">
      <search className="partner-registry-search" aria-label="البحث والتصفية في سجل الشركاء">
        <form onSubmit={(event) => { event.preventDefault(); navigate(enabledFilter, query.trim().slice(0, 100), sort); }}>
          <label className="field-label" htmlFor="partner-roster-search">رقم الهاتف<input id="partner-roster-search" inputMode="tel" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث برقم الهاتف" /></label>
          <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
        </form>
      </search>
      <label className="field-label" htmlFor="partner-roster-status">حالة الدور<select id="partner-roster-status" value={enabledFilter} onChange={(event) => navigate(event.target.value, appliedQuery, sort)} disabled={loading}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label>
      <label className="field-label" htmlFor="partner-roster-sort">ترتيب الهاتف<select id="partner-roster-sort" value={sort} onChange={(event) => navigate(enabledFilter, appliedQuery, event.target.value as "phone_asc" | "phone_desc")} disabled={loading}><option value="phone_asc">الأقل رقمًا أولًا</option><option value="phone_desc">الأعلى رقمًا أولًا</option></select></label>
      <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
    </div>

    {enabledFilter || appliedQuery ? <section className="partner-active-filters" aria-label="التصفية النشطة">
      {enabledFilter ? <button type="button" className="filter-chip" onClick={() => navigate("", appliedQuery, sort)}>{enabledFilter === "true" ? "الحالة: مفعّل" : "الحالة: موقوف"}<span aria-hidden="true"> ×</span><span className="visually-hidden">مسح تصفية الحالة</span></button> : null}
      {appliedQuery ? <button type="button" className="filter-chip" onClick={() => navigate(enabledFilter, "", sort)}>الهاتف: <bdi dir="ltr">{appliedQuery}</bdi><span aria-hidden="true"> ×</span><span className="visually-hidden">مسح البحث</span></button> : null}
      <button type="button" className="button button-secondary" onClick={() => navigate("", "", "phone_asc")}>مسح الكل</button>
    </section> : null}

    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة سجل الشركاء</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
    {loading && items.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة Identity وDSH</strong></div> : null}
    {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>غيّر عوامل البحث أو امسحها لعرض بقية الشركاء.</p></div> : null}

    {items.length > 0 ? <>
      <div className="partner-registry-summary">
        <span>الصفحة الحالية · {items.length} سجلًا</span>
        <fieldset className="partner-registry-bulk-actions"><legend className="visually-hidden">إجراءات السجلات المحددة</legend><span aria-live="polite">المحدد: {selectedOnPage}</span><button type="button" className="button button-secondary" onClick={exportSelected} disabled={selectedOnPage === 0}>تصدير المحدد CSV</button><button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={selectedOnPage === 0}>إلغاء التحديد</button></fieldset>
      </div>
      <div className="partner-registry-table-wrap" aria-busy={loading}>
        <table className="operations-table partner-registry-table">
          <caption className="visually-hidden">سجل حسابات الشركاء الحالي من Identity</caption>
          <thead><tr><th scope="col"><span className="visually-hidden">تحديد</span><input aria-label={allSelected ? "إلغاء تحديد كل سجلات الصفحة" : "تحديد كل سجلات الصفحة"} type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(items.map((partner) => partner.actorId)) : new Set())} /></th><th scope="col">الشريك</th><th scope="col">الهوية الأمنية</th><th scope="col">الدور</th><th scope="col">التفعيل</th><th scope="col">التفاصيل</th></tr></thead>
          <tbody>{items.map((partner) => <tr key={partner.actorId}>
            <td><input type="checkbox" aria-label={`تحديد الشريك ${partner.phoneE164}`} checked={selectedIds.has(partner.actorId)} onChange={() => toggleSelected(partner.actorId)} /></td>
            <th scope="row"><bdi dir="ltr">{partner.phoneE164}</bdi></th>
            <td>{partner.securityEnabled ? "نشطة" : "موقوفة"}</td>
            <td>{partner.enabled ? "مفعّل" : "موقوف"}</td>
            <td>{partner.activatedAt ? "مكتمل" : "بانتظار التفعيل"}</td>
            <td><Link className="partner-row-action" href={`/partners/actors/${encodeURIComponent(partner.actorId)}`}>فتح الملف <span aria-hidden="true">←</span></Link></td>
          </tr>)}</tbody>
        </table>
      </div>
      <nav className="partner-registry-pagination" aria-label="صفحات سجل الشركاء">
        <button type="button" className="button button-secondary" disabled={loading || cursorStack.length === 0} onClick={() => navigate(enabledFilter, appliedQuery, sort, cursorStack.at(-1) ?? "", cursorStack.slice(0, -1))}>السابق</button>
        <span aria-live="polite">{cursorStack.length + 1}</span>
        <button type="button" className="button button-secondary" disabled={loading || !nextCursor} onClick={() => navigate(enabledFilter, appliedQuery, sort, nextCursor, [...cursorStack, cursor])}>التالي</button>
      </nav>
    </> : null}
  </section>;
}
