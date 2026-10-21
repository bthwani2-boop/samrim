"use client";
import { captainAssignmentStateLabel, formatOrderDate, type OperatorOperationListItem, type OperatorOperationsSummary, orderStateLabel } from "@bthwani/dsh";
import { useEffect, useState } from "react";
import { OrderOperationDetail } from "../operations/order-operation-detail";
import { useReadOnReturn } from "../shared/use-read-on-return";

type View = "all" | "attention" | "dispatch" | "delivered";
export function StoreOperationsPreview({ storeId, compact = false, onSummary }: Readonly<{
  storeId: string; compact?: boolean; onSummary?: (value: OperatorOperationsSummary | null) => void;
}>) {
  const [view, setView] = useState<View>("all");
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [next, setNext] = useState("");
  const [rows, setRows] = useState<OperatorOperationListItem[]>([]);
  const [summary, setSummary] = useState<OperatorOperationsSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh intentionally re-reads after an operator refresh or completed action.
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError("");
    const q = new URLSearchParams({ storeId, limit: compact ? "6" : "20" });
    if (view === "attention") q.set("actionableOnly", "true");
    if (view === "dispatch") q.set("state", "READY_FOR_DISPATCH");
    if (view === "delivered") q.set("state", "DELIVERED");
    if (cursor) q.set("cursor", cursor);
    void (async () => {
      try {
        const response = await fetch("/api/operations?" + q, { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error(response.status === 403 ? "قراءة طلبات المتجر تتطلب صلاحية العمليات." : "تعذرت قراءة الطلبات من DSH.");
        const body = await response.json() as { operations?: OperatorOperationListItem[]; summary?: OperatorOperationsSummary; nextCursor?: unknown };
        if (!Array.isArray(body.operations) || !body.summary || (body.nextCursor !== undefined && typeof body.nextCursor !== "string")
          || !Number.isSafeInteger(body.summary.totalCount)) throw new Error("استجابة طلبات المتجر غير صالحة.");
        if (abort.signal.aborted) return;
        setRows(body.operations); setSummary(body.summary); setNext(typeof body.nextCursor === "string" ? body.nextCursor : "");
        if (view === "all") onSummary?.(body.summary);
      } catch (cause) {
        if (abort.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "تعذر تحميل الطلبات.");
        setRows([]); setSummary(null); setNext("");
        if (view === "all") onSummary?.(null);
      } finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  }, [compact, cursor, onSummary, refresh, storeId, view]);

  useReadOnReturn(() => setRefresh((value) => value + 1), !loading && !selected);

  const changeView = (choice: View) => { setView(choice); setCursor(""); setPrevious([]); setSelected(""); };
  return <section className="store-operations" aria-label="طلبات هذا المتجر">
    <div className="store-operations-toolbar">
      <fieldset className="store-operations-filters"><legend className="visually-hidden">حالة الطلبات</legend>
        {([["all", "الكل"], ["attention", "تحتاج متابعة"], ["dispatch", "بانتظار كابتن"], ["delivered", "تم التسليم"]] as const)
          .map(([key, label]) => <button type="button" key={key} aria-pressed={view === key}
            data-active={view === key} onClick={() => changeView(key)}>{label}</button>)}
      </fieldset>

    </div>
    {summary ? <p className="store-operations-caption">{summary.totalCount} طلب مطابق · آخر قراءة <time dateTime={summary.measuredAt}>{formatOrderDate(summary.measuredAt)}</time></p> : null}
    {loading && !summary ? <p role="status" className="store-operations-empty">جارٍ قراءة طلبات المتجر…</p> : null}
    {error ? <div className="store-operations-error" role="alert">{error}<button type="button" onClick={() => setRefresh((value) => value + 1)}>إعادة المحاولة</button></div> : null}
    {!loading && !error && !rows.length ? <p className="store-operations-empty">لا توجد طلبات في هذا العرض.</p> : null}
    {rows.length ? <section className="store-operations-table-scroll" aria-label="جدول طلبات المتجر">
      <table className="store-operations-table">
        <thead><tr><th scope="col">الحالة</th><th scope="col">الكابتن</th><th scope="col">آخر تحديث</th><th scope="col">إجراء</th></tr></thead>
        <tbody>{rows.map((item) => <tr key={item.orderId}>
          <th scope="row">{orderStateLabel(item.state)}</th>
          <td>{item.assignment ? captainAssignmentStateLabel(item.assignment.state) : "لم يُسند"}</td>
          <td><time dateTime={item.updatedAt}>{formatOrderDate(item.updatedAt)}</time></td>
          <td><button type="button" onClick={() => setSelected(item.orderId)} aria-label={`فتح تفاصيل الطلب بحالة ${orderStateLabel(item.state)}`}>فتح</button></td>
        </tr>)}</tbody>
      </table>
    </section> : null}
    {previous.length || next ? <div className="store-operations-pages">
      <button type="button" disabled={loading || !previous.length} onClick={() => {
        setCursor(previous.at(-1) ?? ""); setPrevious((value) => value.slice(0, -1)); setSelected("");
      }}>السابق</button>
      <button type="button" disabled={loading || !next} onClick={() => {
        setPrevious((value) => [...value, cursor]); setCursor(next); setSelected("");
      }}>التالي</button>
    </div> : null}
    {selected ? <div className="store-operations-detail">
      <OrderOperationDetail orderId={selected} embedded onClose={() => setSelected("")}
        onUpdated={() => setRefresh((value) => value + 1)} />
    </div> : null}
  </section>;
}
