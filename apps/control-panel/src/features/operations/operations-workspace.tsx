"use client";

import { formatOrderDate, orderStateLabel, type OperatorOperationListItem } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";
import { operationActionLabel, resolveOperatorAction, type OperatorAction } from "./operator-actions";
import "./operations-workspace.module.css";

const filterOptions: ReadonlyArray<Readonly<{ value: string; label: string }>> = [
  { value: "", label: "كل الأعمال" },
  { value: "READY_FOR_DISPATCH", label: "جاهز للتوزيع" },
  { value: "CAPTAIN_ASSIGNED", label: "مُسند إلى كابتن" },
  { value: "IN_CUSTODY", label: "في عهدة الكابتن" },
  { value: "DELIVERY_FAILED", label: "يحتاج استعادة" },
];

export function OperationsWorkspace() {
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [cursor, setCursor] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadSequence = useRef(0);

  const syncFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get("state") ?? "";
    setFilter(filterOptions.some((option) => option.value === requestedState) ? requestedState : "");
    setCursor(params.get("cursor") ?? "");
    const requestedQuery = params.get("q")?.trim().slice(0, 128) ?? "";
    setSearch(requestedQuery);
    setAppliedQuery(requestedQuery);
    setSort(params.get("sort") === "updated_asc" ? "updated_asc" : "updated_desc");
  }, []);

  useEffect(() => {
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  const navigateQuery = useCallback((state: string, pageCursor: string, queryText = appliedQuery, nextSort = sort) => {
    const params = new URLSearchParams(window.location.search);
    if (state) params.set("state", state);
    else params.delete("state");
    if (pageCursor) params.set("cursor", pageCursor);
    else params.delete("cursor");
    if (queryText) params.set("q", queryText);
    else params.delete("q");
    if (nextSort !== "updated_desc") params.set("sort", nextSort);
    else params.delete("sort");
    const queryString = params.toString();
    window.history.pushState({}, "", window.location.pathname + (queryString ? `?${queryString}` : ""));
    setFilter(state);
    setCursor(pageCursor);
    setAppliedQuery(queryText);
    setSearch(queryText);
    setSort(nextSort);
  }, [appliedQuery, sort]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (filter) query.set("state", filter);
      if (appliedQuery) query.set("q", appliedQuery);
      if (sort !== "updated_desc") query.set("sort", sort);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch("/api/operations?" + query.toString(), { cache: "no-store" });
      if (sequence !== loadSequence.current) return;
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as { operations?: ReadonlyArray<OperatorOperationListItem>; nextCursor?: string };
      if (sequence !== loadSequence.current) return;
      setOperations(body.operations ?? []);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة مركز العمليات.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [appliedQuery, cursor, filter, sort]);

  useEffect(() => { if (urlReady) void load(); }, [load, urlReady]);

  async function runAction(action: OperatorAction, item: OperatorOperationListItem) {
    if (resolveOperatorAction(item) !== action) return;
    const assignment = item.assignment;
    setBusy(action + ":" + item.orderId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          orderId: item.orderId,
          assignmentId: assignment?.id ?? "",
          ...(action === "recover" ? { expectedVersion: assignment?.version } : {}),
        }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      setNotice("تم تنفيذ «" + operationActionLabel(action) + "» ثم إعادة قراءة الحالة الكانونية.");
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تنفيذ إجراء العمليات.");
    } finally {
      setBusy("");
    }
  }

  const actionableCount = useMemo(
    () => operations.filter((item) => resolveOperatorAction(item) !== null).length,
    [operations],
  );

  return (
    <section className="operations-workspace" aria-labelledby="operations-list-title">
      <div className="workspace-toolbar">
        <form className="workspace-search" role="search" onSubmit={(event) => { event.preventDefault(); navigateQuery(filter, "", search.trim().slice(0, 128), sort); }}>
          <label className="field-label" htmlFor="operations-search">
            البحث في رقم الطلب أو اسم المتجر
            <input id="operations-search" type="search" value={search} maxLength={128} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن طلب أو متجر" />
          </label>
          <button type="submit" className="button button-secondary" disabled={loading || Boolean(busy)}>بحث</button>
        </form>
        <label className="field-label" htmlFor="operations-state-filter">
          تصفية العمل
          <select id="operations-state-filter" value={filter} onChange={(event) => navigateQuery(event.target.value, "")} disabled={Boolean(busy)}>
            {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="field-label" htmlFor="operations-sort">
          ترتيب حسب آخر تحديث
          <select id="operations-sort" value={sort} onChange={(event) => navigateQuery(filter, "", appliedQuery, event.target.value)} disabled={Boolean(busy)}>
            <option value="updated_desc">الأحدث أولًا</option>
            <option value="updated_asc">الأقدم أولًا</option>
          </select>
        </label>
        <div className="toolbar-meta">
          <span className="toolbar-count">{actionableCount} أعمال تحتاج قرارًا مباشرًا ضمن القراءة الحالية</span>
          <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || Boolean(busy)}>
            {loading ? "جارٍ القراءة…" : "إعادة القراءة"}
          </button>
        </div>
      </div>

      {filter || appliedQuery ? (
        <div className="active-filter-chips" aria-label="عوامل التصفية النشطة">
          {filter ? <button type="button" className="filter-chip" onClick={() => navigateQuery("", "")}>الحالة: {filterOptions.find((option) => option.value === filter)?.label} <span aria-hidden="true">×</span><span className="visually-hidden">إزالة تصفية الحالة</span></button> : null}
          {appliedQuery ? <button type="button" className="filter-chip" onClick={() => navigateQuery(filter, "", "")}>البحث: {appliedQuery} <span aria-hidden="true">×</span><span className="visually-hidden">مسح البحث</span></button> : null}
        </div>
      ) : null}

      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال القراءة أو الإجراء</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || Boolean(busy)}>إعادة المحاولة</button></div> : null}
      {loading && operations.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة مركز العمليات</strong><p>نطلب مجموعة محدودة من DSH ولا نبني العمل من طلبات منفصلة.</p></div> : null}
      {!loading && !error && operations.length === 0 ? <div className="collection-state"><strong>{filter || appliedQuery ? "لا توجد نتائج تطابق عوامل البحث والتصفية" : "لا توجد أعمال في هذا النطاق"}</strong><p>{filter || appliedQuery ? "امسح عاملًا أو أكثر لعرض سجلات أخرى." : "ستظهر الطلبات عندما تصل إلى مسار التشغيل الذي يملك المشغل إجراءً عليه."}</p></div> : null}

      {operations.length > 0 ? (
        <div className="operations-table-wrap">
          <table className="operations-table">
            <caption id="operations-list-title" className="visually-hidden">أعمال التشغيل الحالية</caption>
            <thead><tr><th scope="col">الطلب</th><th scope="col">المتجر</th><th scope="col">الحالة</th><th scope="col">آخر تحديث</th><th scope="col">الإجراء</th></tr></thead>
            <tbody>
              {operations.map((item) => {
                const action = resolveOperatorAction(item);
                const actionBusy = action ? busy === action + ":" + item.orderId : false;
                return (
                  <tr key={item.orderId}>
                    <th scope="row"><Link href={`/operations/${encodeURIComponent(item.orderId)}`}><bdi dir="ltr">{item.orderId}</bdi></Link></th>
                    <td>{item.storeName}</td>
                    <td><span className={"status-badge status-" + item.state.toLowerCase()}>{orderStateLabel(item.state)}</span></td>
                    <td><time dateTime={item.updatedAt}>{formatOrderDate(item.updatedAt)}</time></td>
                    <td>
                      {action ? (
                        <button type="button" className={"button " + (action === "recover" ? "button-secondary" : "button-primary") + " table-action"} onClick={() => void runAction(action, item)} disabled={Boolean(busy)}>
                          {actionBusy ? "جارٍ التنفيذ…" : operationActionLabel(action)}
                        </button>
                      ) : <span className="muted">لا إجراء مشغل مطلوب</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" onClick={() => navigateQuery(filter, nextCursor)} disabled={loading || Boolean(busy)}>قراءة الصفحة التالية</button></div> : null}
    </section>
  );
}
