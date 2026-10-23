"use client";

import type { OperatorOperationListItem, OperatorOperationsSummary } from "@bthwani/dsh";
import { formatOrderDate, orderStateLabel } from "@bthwani/dsh";
import { CommandBarPanel, CommandDecisionList, CommandMetricStrip, type CommandMetric } from "../shared/command-surface";
import { OpportunityZones } from "./opportunity-zones";

export function OperationsCommandView({ summary, operations, isAttention, onView, onOpen, loading }: Readonly<{
  summary: OperatorOperationsSummary | null;
  operations: readonly OperatorOperationListItem[];
  isAttention: (item: OperatorOperationListItem) => boolean;
  onView: (view: "all" | "attention" | "dispatch" | "delivered") => void;
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
    <div className="bt-command-grid">
      <CommandBarPanel title="حالات الطلبات المعروضة" subtitle="توزيع السجلات المحمّلة، وليس كامل المنصة"
        measures={breakdown} total={operations.length}/>
      <CommandBarPanel title="مؤشرات سير الطلب" subtitle="مؤشرات غير حصرية من ملخص DSH"
        measures={summary ? [
          { id: "review", label: "تحتاج تدخلاً", value: summary.actionableCount, tone: "danger" },
          { id: "dispatch", label: "بانتظار الإسناد", value: summary.awaitingDispatchCount, tone: "warning" },
          { id: "active", label: "نشطة", value: summary.activeCount, tone: "success" },
          { id: "delivered", label: "مسلّمة", value: summary.deliveredCount },
        ] : []} total={summary?.totalCount ?? null}/>
    </div>
    <CommandDecisionList title="الأولويات التشغيلية" items={attention.map(item => ({
      id: item.orderId, title: item.storeName, description: orderStateLabel(item.state) + " · " + formatOrderDate(item.updatedAt),
      tone: "danger" as const, action: () => onOpen(item.orderId),
    }))} footer={<button type="button" onClick={() => onView("attention")}>عرض جميع الحالات التي تحتاج تدخلاً ←</button>} />
    <p className="bt-command-footnote" role="status">{loading ? "جارٍ التحقق من أحدث البيانات..." :
      summary ? "آخر قياس تشغيلي: " + formatOrderDate(summary.measuredAt) + " · القوائم التحليلية تعرض السجلات المحمّلة فقط." :
      "ملخص العمليات غير متاح حاليًا. لا تُعرض أرقام افتراضية."}</p>
    <OpportunityZones />
  </div>;
}
