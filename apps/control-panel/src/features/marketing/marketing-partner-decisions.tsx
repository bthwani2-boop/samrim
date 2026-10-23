"use client";

import type { OperatorPartnerDecisionPage } from "@bthwani/dsh";
import { useEffect, useState } from "react";

type Decision = "" | "PENDING" | "OPTED_IN" | "DECLINED";
const labels: Record<Decision, string> = {
  "": "الكل",
  PENDING: "بانتظار القرار",
  OPTED_IN: "موافق",
  DECLINED: "رافض",
};

export function MarketingPartnerDecisions({ promotionId }: Readonly<{ promotionId: string }>) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Decision>("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [data, setData] = useState<OperatorPartnerDecisionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const q = new URLSearchParams({ limit: "25" });
    if (filter) q.set("decision", filter);
    if (cursor) q.set("cursor", cursor);
    void fetch("/api/marketing/promotions/" + encodeURIComponent(promotionId) + "/partner-decisions?" + q.toString(), {
      cache: "no-store", signal: controller.signal,
    }).then(async (r) => {
      if (!r.ok) throw new Error("تعذر قراءة قرارات المتاجر");
      const body = await r.json() as OperatorPartnerDecisionPage;
      if (!Array.isArray(body.items) || (body.nextCursor !== undefined && typeof body.nextCursor !== "string")) throw new Error("استجابة غير صحيحة");
      if (!controller.signal.aborted) setData(body);
    }).catch(() => { if (!controller.signal.aborted) setError("تعذر قراءة مشاركة الشركاء."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, promotionId, filter, cursor]);

  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>قرارات الشركاء</summary>
    {open ? <div className="work-stack">
      <label className="field-label">حالة المشاركة
        <select value={filter} onChange={(event) => {
          setFilter(event.target.value as Decision); setCursor(""); setHistory([]);
        }}>
          {(Object.keys(labels) as Decision[]).map((value) => <option key={value} value={value}>{labels[value]}</option>)}
        </select>
      </label>
      {loading ? <p role="status">قراءة القرارات...</p> : error ? <p role="alert">{error}</p> :
        data?.items.length ? <ul>{data.items.map((item) => <li key={item.storeId}>
          {item.storeName} — {labels[(item.decision || "PENDING") as Decision] ?? "غير معروف"}
        </li>)}</ul> : <p className="muted">لا توجد نتائج مطابقة.</p>}
      <nav className="pagination" aria-label="صفحات قرارات الشركاء">
        <button className="button button-quiet" type="button" disabled={loading || history.length === 0}
          onClick={() => { const stack = [...history]; const previous = stack.pop() ?? ""; setHistory(stack); setCursor(previous); }}>السابق</button>
        <span>صفحة {history.length + 1}</span>
        <button className="button button-quiet" type="button" disabled={loading || !data?.nextCursor}
          onClick={() => { setHistory((items) => [...items, cursor]); setCursor(data?.nextCursor ?? ""); }}>التالي</button>
      </nav>
    </div> : null}
  </details>;
}
