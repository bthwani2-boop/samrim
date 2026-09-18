"use client";

import { orderStateLabel, formatMoney, formatOrderDate, type OperatorOperation } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type OperationAction = "dispatch" | "reassign" | "recover";

const filterOptions: ReadonlyArray<Readonly<{ value: string; label: string }>> = [
  { value: "", label: "كل الأعمال" },
  { value: "READY_FOR_DISPATCH", label: "جاهز للتوزيع" },
  { value: "CAPTAIN_ASSIGNED", label: "مُسند إلى كابتن" },
  { value: "IN_CUSTODY", label: "في عهدة الكابتن" },
  { value: "DELIVERY_FAILED", label: "يحتاج استعادة" },
];

function operationActionLabel(action: OperationAction): string {
  if (action === "dispatch") return "إرسال للتوزيع";
  if (action === "reassign") return "إعادة التوزيع";
  return "استعادة التسليم";
}

function canRun(item: OperatorOperation, action: OperationAction): boolean {
  if (action === "dispatch") return item.order.state === "READY_FOR_DISPATCH";
  if (action === "reassign") return item.order.state === "CAPTAIN_ASSIGNED" && item.assignment?.state === "assigned";
  return item.order.state === "DELIVERY_FAILED" && item.assignment?.state === "delivery_failed";
}

export function OperationsWorkspace() {
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperation>>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (filter) query.set("state", filter);
      const response = await fetch("/api/operations?" + query.toString(), { cache: "no-store" });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as { operations?: ReadonlyArray<OperatorOperation> };
      setOperations(body.operations ?? []);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة مركز العمليات.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function runAction(action: OperationAction, item: OperatorOperation) {
    if (!canRun(item, action)) return;
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
    () => operations.filter((item) => item.order.state === "READY_FOR_DISPATCH" || item.order.state === "DELIVERY_FAILED").length,
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
                const action = order.state === "READY_FOR_DISPATCH" ? "dispatch" : order.state === "DELIVERY_FAILED" ? "recover" : order.state === "CAPTAIN_ASSIGNED" && item.assignment?.state === "assigned" ? "reassign" : null;
                const actionBusy = action ? busy === action + ":" + order.id : false;
                return (
                  <tr key={order.id}>
                    <th scope="row">
                      <details className="operation-details">
                        <summary><bdi dir="ltr">{order.id}</bdi></summary>
                        <div className="operation-detail-body">
                          <span>{order.lines.length} عناصر · {formatMoney(order.totalAmountMinor, order.currency)}</span>
                          {item.assignment ? <span>التكليف: <bdi dir="ltr">{item.assignment.id}</bdi></span> : null}
                        </div>
                      </details>
                    </th>
                    <td>{item.storeName}</td>
                    <td><span className={"status-badge status-" + order.state.toLowerCase()}>{orderStateLabel(order.state)}</span></td>
                    <td><time dateTime={order.updatedAt}>{formatOrderDate(order.updatedAt)}</time></td>
                    <td>
                      {action ? (
                        <button type="button" className={"button " + (action === "recover" ? "button-secondary" : "button-primary") + " table-action"} onClick={() => void runAction(action, item)} disabled={Boolean(busy) || !canRun(item, action)}>
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
    </section>
  );
}
