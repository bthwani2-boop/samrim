"use client";

import type { OperatorOperationsSummary } from "@bthwani/dsh";
import { OpportunityZones } from "./opportunity-zones";

export function OperationsCoverageWorkspace({ summary, onDispatch, onCaptains }: Readonly<{
  summary: OperatorOperationsSummary | null;
  onDispatch: () => void;
  onCaptains: () => void;
}>) {
  return <section className="ops-coverage-workspace" data-testid="operations-coverage-workspace">
    <div className="ops-decision-heading">
      <div><h2>التغطية والجاهزية</h2><p>فرّق بين نشاط الطلبات الجغرافي وبين إحصاءات التشغيل العامة.</p></div>
      <span className="ops-decision-scope">المواقع المتاحة دورية وليست تتبعًا مباشرًا</span>
    </div>
    <div className="ops-coverage-fallback">
      <div><span>طلبات تنتظر الإسناد</span><strong>{summary ? summary.awaitingDispatchCount.toLocaleString("ar-YE") : "—"}</strong><small>من ملخص DSH، دون توزيع جغرافي</small></div>
      <div><span>طلبات قيد التوصيل</span><strong>{summary ? summary.inCustodyOrderCount.toLocaleString("ar-YE") : "—"}</strong><small>من الملخص التشغيلي، لا يمثل عدد الكباتن المتاحين</small></div>
      <div className="ops-coverage-quick-actions"><button type="button" onClick={onDispatch}>افتح الإسناد ←</button>
        <button type="button" onClick={onCaptains}>جاهزية الكباتن ←</button></div>
    </div>
    <OpportunityZones variant="full" />
    <p className="ops-dispatch-scope">تحتاج مقارنة عرض الكباتن والطلب بحسب المنطقة إلى عينات ذات إحداثيات حديثة. لا تُستنتج التغطية من عداد الطلبات وحده.</p>
  </section>;
}
