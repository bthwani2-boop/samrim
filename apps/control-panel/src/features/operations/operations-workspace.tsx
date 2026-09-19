"use client";

import { orderStateLabel, formatMoney, formatOrderDate, type OperatorOperation } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperation>>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [details, setDetails] = useState<Readonly<Record<string, OperatorOperation>>>({});
  const [detailBusy, setDetailBusy] = useState("");

  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (filter) query.set("state", filter);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch("/api/operations?" + query.toString(), { cache: "no-store" });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as { operations?: ReadonlyArray<OperatorOperation>; nextCursor?: string };
      setOperations((current) => append ? [...current, ...(body.operations ?? [])] : (body.operations ?? []));
      setNextCursor(body.nextCursor ?? "");
      if (!append) setDetails({});
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة مركز العمليات.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function readDetail(orderId: string) {
    if (details[orderId] || detailBusy === orderId) return;
    setDetailBusy(orderId);
    setError("");
    try {
      const response = await fetch("/api/operations/" + encodeURIComponent(orderId), { cache: "no-store" });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as { operation?: OperatorOperation };
      if (body.operation) setDetails((current) => ({ ...current, [orderId]: body.operation as OperatorOperation }));
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر إعادة قراءة تفاصيل العملية.");
    } finally {
      setDetailBusy("");
    }
  }

  async function runAction(action: OperatorAction, item: OperatorOperation) {
    if (resolveOperatorAction(item) !== action) return;
    const assignment = item.assignment;
    setBusy(action + ":" + item.order.id);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          orderId: item.order.id,
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
        <label className="field-label" htmlFor="operations-state-filter">
          تصفية العمل
          <select id="operations-state-filter" value={filter} onChange={(event) => setFilter(event.target.value)} disabled={Boolean(busy)}>
            {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="toolbar-meta">
          <span className="toolbar-count">{actionableCount} أعمال تحتاج قرارًا مباشرًا ضمن القراءة الحالية</span>
          <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || Boolean(busy)}>
            {loading ? "جارٍ القراءة…" : "إعادة القراءة"}
          </button>
        </div>
      </div>

      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال القراءة أو الإجراء</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || Boolean(busy)}>إعادة المحاولة</button></div> : null}
      {loading && operations.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة مركز العمليات</strong><p>نطلب مجموعة محدودة من DSH ولا نبني العمل من طلبات منفصلة.</p></div> : null}
      {!loading && !error && operations.length === 0 ? <div className="collection-state"><strong>لا توجد أعمال في هذا النطاق</strong><p>ستظهر الطلبات عندما تصل إلى مسار التشغيل الذي يملك المشغل إجراءً عليه.</p></div> : null}

      {operations.length > 0 ? (
        <div className="operations-table-wrap">
          <table className="operations-table">
            <caption id="operations-list-title" className="visually-hidden">أعمال التشغيل الحالية</caption>
            <thead><tr><th scope="col">الطلب</th><th scope="col">المتجر</th><th scope="col">الحالة</th><th scope="col">آخر تحديث</th><th scope="col">الإجراء</th></tr></thead>
            <tbody>
              {operations.map((item) => {
                const order = item.order;
                const action = resolveOperatorAction(item);
                const detail = details[order.id] ?? item;
                const actionBusy = action ? busy === action + ":" + order.id : false;
                return (
                  <tr key={order.id}>
                    <th scope="row">
                      <details className="operation-details" onToggle={(event) => { if (event.currentTarget.open) void readDetail(order.id); }}>
                        <summary><bdi dir="ltr">{order.id}</bdi></summary>
                        <div className="operation-detail-body">
                          {detailBusy === order.id ? <span role="status">جارٍ إعادة قراءة التفاصيل…</span> : null}
                          <span>{detail.order.lines.length} عناصر · {formatMoney(detail.order.totalAmountMinor, detail.order.currency)}</span>
                          <span>العنوان: {detail.order.addressText}</span>
                          <span>مدينة الخدمة: <bdi dir="ltr">{detail.order.serviceCityId}</bdi> · قابلية الخدمة: {detail.order.serviceabilityStatus}</span>
                          <ul>
                            {detail.order.lines.map((line) => <li key={line.id}>{line.productName}{line.variantTitle ? ` · ${line.variantTitle}` : ""} · {line.finalQuantityBaseUnits} · {formatMoney(line.lineAmountMinor, line.currency)}</li>)}
                          </ul>
                          {detail.assignment ? <span>التكليف: <bdi dir="ltr">{detail.assignment.id}</bdi> · {detail.assignment.state} · {detail.assignment.handoffState} · الإصدار {detail.assignment.version}</span> : <span>لا يوجد تكليف كابتن حالي.</span>}
                          <span>إصدار الطلب {detail.order.version} · آخر تحديث <time dateTime={detail.order.updatedAt}>{formatOrderDate(detail.order.updatedAt)}</time></span>
                        </div>
                      </details>
                    </th>
                    <td>{item.storeName}</td>
                    <td><span className={"status-badge status-" + order.state.toLowerCase()}>{orderStateLabel(order.state)}</span></td>
                    <td><time dateTime={order.updatedAt}>{formatOrderDate(order.updatedAt)}</time></td>
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
      {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" onClick={() => void load(nextCursor, true)} disabled={loading || loadingMore || Boolean(busy)}>{loadingMore ? "جارٍ قراءة المزيد…" : "قراءة الصفحة التالية"}</button></div> : null}
    </section>
  );
}
