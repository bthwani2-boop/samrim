"use client";

import type { OperatorOperationListItem, OperatorOperationsSummary } from "@bthwani/dsh";
import { formatOrderDate, orderStateLabel } from "@bthwani/dsh";
import { CommandBarPanel, CommandDecisionList, CommandMetricStrip, type CommandMetric } from "../shared/command-surface";
import { OpportunityZones } from "./opportunity-zones";

export function OperationsCommandView({ summary, operations, isAttention, onView, onOpen, loading }: Readonly<{
  summary: OperatorOperationsSummary | null;
  operations: readonly OperatorOperationListItem[];
  isAttention: (item: OperatorOperationListItem) => boolean;
  onView: (view: "all" | "attention" | "dispatch" | "delivered" | "captains" | "coverage" | "reports") => void;
  onOpen: (orderId: string) => void;
  loading: boolean;
}>) {
  const metrics: readonly CommandMetric[] = [
    { id: "active", label: "الطلبات النشطة", value: summary?.activeCount ?? null, description: "من ملخص العمليات الموثوق", tone: "success", action: () => onView("all") },
    { id: "review", label: "تحتاج تدخلاً", value: summary?.actionableCount ?? null, description: "حالات تستلزم قرارًا تشغيليًا", tone: "danger", action: () => onView("attention") },
    { id: "dispatch", label: "بانتظار الإسناد", value: summary?.awaitingDispatchCount ?? null, description: "طلبات تحتاج كابتنًا", tone: "warning", action: () => onView("dispatch") },
    { id: "delivered", label: "تم تسليمها", value: summary?.deliveredCount ?? null, description: "ضمن ملخص المصدر", tone: "normal", action: () => onView("delivered") },
    { id: "custody", label: "في عهدة التوصيل", value: summary?.inCustodyOrderCount ?? null, description: "الحالات قيد التسليم", tone: "normal" },
  ];
  const attention = operations.filter(isAttention).slice(0, 5);
  const byState = new Map<OperatorOperationListItem["state"], number>();
  for (const item of operations) byState.set(item.state, (byState.get(item.state) ?? 0) + 1);
  const breakdown = Array.from(byState, ([id, value]) => ({ id, label: orderStateLabel(id), value }))
    .sort((a, b) => b.value - a.value).slice(0, 6);
  return <div className="bt-command-coverage" data-testid="operations-command">
    <CommandMetricStrip metrics={metrics} />
    <div className="bt-command-grid ops-command-map-and-queue">
      <OpportunityZones />
    <CommandDecisionList title="الأولويات التشغيلية" items={attention.map(item => ({
      id: item.orderId, title: item.storeName, description: orderStateLabel(item.state) + " · " + formatOrderDate(item.updatedAt),
      tone: "danger" as const, action: () => onOpen(item.orderId),
    }))} footer={<button type="button" onClick={() => onView("attention")}>عرض جميع الحالات التي تحتاج تدخلاً ←</button>} />
    </div>
    <div className="bt-command-grid">
      <CommandBarPanel title="حالات الطلبات المعروضة" subtitle="توزيع السجلات المحمّلة، وليس كامل المنصة"
        measures={breakdown} total={operations.length}/>
      <section className="bt-command-panel ops-command-shortcuts" aria-labelledby="ops-command-action-title">
        <h2 id="ops-command-action-title">المسارات التشغيلية</h2>
        <p>افتح مجال العمل المناسب من دون تكرار مؤشرات القيادة داخل كل تبويب.</p>
        <div className="ops-command-link-grid">
          <button type="button" onClick={() => onView("dispatch")}>الإسناد والتوصيل <span>الطلبات والمراحل ←</span></button>
          <button type="button" onClick={() => onView("captains")}>الكباتن <span>الأهلية والتوفر ←</span></button>
          <button type="button" onClick={() => onView("coverage")}>التغطية <span>النشاط الجغرافي ←</span></button>
          <button type="button" onClick={() => onView("reports")}>الأداء والتقارير <span>التاريخ اليومي ←</span></button>
        </div>
      </section>
    </div>
    <p className="bt-command-footnote" role="status">{loading ? "جارٍ التحقق من أحدث البيانات..." :
      summary ? "آخر قياس تشغيلي: " + formatOrderDate(summary.measuredAt) + " · القوائم التحليلية تعرض السجلات المحمّلة فقط." :
      "ملخص العمليات غير متاح حاليًا. لا تُعرض أرقام افتراضية."}</p>
  </div>;
}
