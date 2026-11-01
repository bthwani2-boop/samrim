"use client";

import { useEffect, useState } from "react";
import type { OperatorHomeAnalytics, OperatorOperationsSummary, OperatorOperationListItem } from "@bthwani/dsh";
import { formatOrderDate } from "@bthwani/dsh";
import { isOperatorHomeAnalytics } from "../workspace/operator-home-analytics";
import { calculateOperationsReportMetrics } from "./operations-report-metrics";

const number = (n: number) => n.toLocaleString("ar-YE");
const safeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export function OperationsPerformance({ summary, loading }: Readonly<{
  summary: OperatorOperationsSummary | null;
  operations: readonly OperatorOperationListItem[];
  loading: boolean;
}>) {
  const [report, setReport] = useState<OperatorHomeAnalytics | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState<7 | 30>(7);
  useEffect(() => {
    let active = true;
    async function read() {
      setReport(null);
      setError("");
      setPending(true);
      try {
        const res = await fetch(`/api/operations/home-analytics?period=${range}d`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error("تعذرت قراءة التقرير اليومي من المصدر.");
        const body: unknown = await res.json();
        if (!isOperatorHomeAnalytics(body, range)) throw new Error("بيانات التقرير اليومي غير صالحة.");
        if (active) { setReport(body); setError(""); }
      } catch (cause) {
        if (active) { setReport(null); setError(cause instanceof Error ? cause.message : "تعذر عرض التقرير."); }
      } finally { if (active) setPending(false); }
    }
    void read();
    return () => { active = false; };
  }, [range]);
  const allDays = report?.days ?? [];
  const days = allDays.slice(-range);
  const { totalOrders, delivered: totalDelivered, failed: totalFailed, cancelled: totalCancelled, averageOrdersPerDay, peakDay, peakOrders } = calculateOperationsReportMetrics(days);
  const maxValue = Math.max(1, ...days.map(item => item.orders));
  function exportReport() {
    if (!report || !allDays.length) return;
    const head = ["day", "orders", "delivered", "awaiting_dispatch", "in_progress", "failed", "cancelled"];
    const body = days.map(d => [d.day, d.orders, d.delivered, d.awaitingDispatch, d.inProgress, d.failed, d.cancelled]);
    const meta = [`# source=DSH operator/home-analytics`, `# timezone=${report.timeZone}`, `# measuredAt=${report.measuredAt}`, `# coverage=returned_daily_aggregate`];
    const csv = "\uFEFF" + [...meta, head.map(safeCsv).join(","), ...body.map(row => row.map(safeCsv).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "bthwani-operations-daily-" + range + ".csv";
    link.click(); URL.revokeObjectURL(url);
  }
  return <section className="ops-report-workspace" data-testid="operations-performance">
    <header className="ops-decision-heading">
      <div><h2>الأداء والتقارير</h2><p>البيانات اليومية الفعلية من DSH، مستقلة عن قائمة الطلبات المحمّلة في المتصفح.</p></div>
      <div className="ops-report-actions">
        <label>الفترة <select value={range} onChange={event => setRange(Number(event.target.value) === 30 ? 30 : 7)}>
          <option value={7}>آخر 7 أيام متاحة</option><option value={30}>آخر 30 يومًا متاحًا</option>
        </select></label>
        <button type="button" onClick={exportReport} disabled={pending || !report || days.length !== range}>تصدير البيانات الظاهرة</button>
      </div>
    </header>
    {pending ? <p className="ops-dispatch-scope" role="status">جارٍ قراءة التقرير اليومي...</p> : null}
    {error ? <p className="managed-status managed-status-warning" role="alert">{error}</p> : null}
    {report ? <>
      <div className="ops-report-metrics">
        <div><span>طلبات الفترة</span><strong>{number(totalOrders)}</strong></div>
        <div><span>طلبات الفترة بحالة تم التسليم</span><strong>{number(totalDelivered)}</strong></div>
        <div><span>طلبات الفترة المتعثرة حاليًا</span><strong>{number(totalFailed)}</strong></div>
        <div><span>عدد الأيام في الفترة</span><strong>{number(days.length)}</strong></div>
        <div><span>طلبات الفترة الملغاة أو المرفوضة</span><strong>{number(totalCancelled)}</strong></div>
        <div><span>متوسط الطلبات المنشأة يوميًا</span><strong>{averageOrdersPerDay === null ? "—" : averageOrdersPerDay.toLocaleString("ar-YE", { maximumFractionDigits: 1 })}</strong></div>
        <div><span>أكثر يوم إنشاءً للطلبات</span><strong>{peakDay ? `${peakDay} · ${number(peakOrders)}` : "—"}</strong></div>
      </div>
      <section className="ops-report-chart" aria-labelledby="ops-daily-trends-title">
        <h3 id="ops-daily-trends-title">الحركة اليومية للطلبات</h3>
        <div className="ops-report-legend"><span>الطلبات <i className="orders" /></span><span>التسليم <i className="delivered" /></span><span>التعثر <i className="failed" /></span></div>
        {days.length ? <div className="ops-report-rows">{days.map(day => <div className="ops-report-day" key={day.day}>
          <time dateTime={day.day}>{day.day}</time>
          <div className="ops-report-bars" role="img" aria-label={`طلبات ${day.orders}، تسليم ${day.delivered}، فشل ${day.failed}`}>
            <span className="orders" style={{width:`${day.orders / maxValue * 100}%`}} />
            <span className="delivered" style={{width:`${day.delivered / maxValue * 100}%`}} />
            <span className="failed" style={{width:`${day.failed / maxValue * 100}%`}} />
          </div><strong>{number(day.orders)}</strong>
        </div>)}</div> : <p>لا توجد أيام ضمن الفترة التي أعادها المصدر.</p>}
      </section>
      <p className="ops-dispatch-scope">آخر تحديث: {formatOrderDate(report.measuredAt)} · المنطقة الزمنية: صنعاء. عدد حالات التسليم ليس معدل نجاح لنفس دفعة الطلبات.</p>
    </> : !pending && !error ? <p className="ops-dispatch-scope">لم يرجع المصدر سجلات يومية معتمدة.</p> : null}
    <section className="ops-report-limits">
      <h3>مؤشرات SLA غير المتاحة بعد</h3>
      <p>زمن قبول المتجر والتجهيز والإسناد والتوصيل يحتاج أحداث مراحل تاريخية وتجميعًا خادميًا مستقلًا، ولا يمكن استخراجه من التقرير اليومي أو سجلات الصفحة دون افتراضات.</p>
      <p>{loading ? "جارٍ تحديث ملخص التشغيل." : summary ? `الملخص التشغيلي الحالي منفصل عن الفترة: ${formatOrderDate(summary.measuredAt)}.` : "لا يوجد ملخص تشغيل متاح في هذه القراءة."}</p>
    </section>
  </section>;
}
