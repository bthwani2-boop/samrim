"use client";

import type { OperatorOperationsSummary, OperatorOperationListItem } from "@bthwani/dsh";
import { formatOrderDate } from "@bthwani/dsh";
import { CommandBarPanel, CommandMetricStrip } from "../shared/command-surface";

export function OperationsPerformance({ summary, operations, loading }: Readonly<{
  summary: OperatorOperationsSummary | null;
  operations: readonly OperatorOperationListItem[];
  loading: boolean;
}>) {
  const byState = new Map<string,number>();
  for (const operation of operations) byState.set(operation.state, (byState.get(operation.state) ?? 0)+1);
  const reportRows=Array.from(byState,([id,value])=>({id,label:id,value})).sort((a,b)=>b.value-a.value);
  return <div className="bt-command-coverage ops-performance" data-testid="operations-performance">
    <header className="ops-context-heading"><h2>الأداء والتقارير</h2><p>فصل مؤشرات التشغيل الحالية عن التحليل التاريخي، مع توضيح نطاق كل مصدر.</p></header>
    <CommandMetricStrip metrics={[
      {id:"total",label:"إجمالي الطلبات في المصدر",value:summary?.totalCount??null,description:"إجمالي الملخص التشغيلي"},
      {id:"active",label:"طلبات نشطة",value:summary?.activeCount??null,description:"قراءة حالية من ملخص DSH",tone:"success"},
      {id:"delivered",label:"طلبات مسلّمة",value:summary?.deliveredCount??null,description:"قراءة حالية، ليست معدل نجاح"},
      {id:"action",label:"تحتاج متابعة",value:summary?.actionableCount??null,description:"وفق الملخص المعتمد",tone:"warning"},
    ]}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="حالات السجلات المسترجعة" subtitle="توزيع العينة الحالية فقط، وليس كامل المنصة" total={operations.length}
        measures={reportRows.slice(0,8)}/>
      <section className="bt-command-panel">
        <div className="bt-command-panel-head"><h2>صلاحية التحليل</h2></div>
        <p className="bt-command-footnote">لا يمكن اشتقاق متوسط زمن التجهيز أو الإسناد أو معدل نجاح التسليم من قائمة الطلبات المحدودة. تحتاج تلك التقارير تجميعًا خادميًا مؤرّخًا لكل مراحل الطلبات.</p>
        <p className="bt-command-footnote">{loading?"جارٍ قراءة البيانات...":summary?
          "وقت آخر ملخص: "+formatOrderDate(summary.measuredAt):
          "بيانات الملخص التشغيلي غير متاحة حاليًا."}</p>
      </section>
    </div>
  </div>;
}
