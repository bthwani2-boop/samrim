"use client";
import type { OperatorOperationsSummary } from "@bthwani/dsh";

const stages = [
  { state: "READY_FOR_DISPATCH", label: "يحتاج إسنادًا", note: "بانتظار قبول كابتن" },
  { state: "CAPTAIN_ASSIGNED", label: "تم الإسناد", note: "قبل الاستلام" },
  { state: "IN_CUSTODY", label: "في عهدة الكابتن", note: "قيد تنفيذ المهمة" },
  { state: "PICKED_UP", label: "في التوصيل", note: "بعد الاستلام" },
  { state: "DELIVERY_FAILED", label: "تعثر التسليم", note: "تحتاج مراجعة" },
] as const;

export function OperationsDispatchOverview({ state, summary, onState, onView }: Readonly<{
  state: string;
  summary: OperatorOperationsSummary | null;
  onState: (state: string) => void;
  onView: (view: "captains" | "coverage" | "attention") => void;
}>) {
  const stage = stages.find(item => item.state === state);
  return <section className="ops-dispatch-center" data-testid="operations-dispatch" aria-labelledby="ops-dispatch-title">
    <div className="ops-decision-heading">
      <div><h2 id="ops-dispatch-title">الإسناد والتوصيل</h2>
        <p>تابع الطلبات في كل مرحلة، ثم افتح الطلب للاطلاع على الإسناد والأدلة والإجراءات المسموح بها.</p></div>
      <span className="ops-decision-scope">المرحلة المختارة: {stage ? stage.label : "مرحلة محددة"}</span>
    </div>
    <fieldset className="ops-dispatch-stages"><legend className="visually-hidden">تصفية مرحلة التوصيل</legend>
      {stages.map(item => <button type="button" key={item.state} className={state === item.state ? "is-current" : ""}
        aria-pressed={state === item.state} onClick={() => onState(item.state)}>
        <strong>{item.label}</strong><small>{item.note}</small>
      </button>)}
    </fieldset>
    <div className="ops-dispatch-links">
      <span>لا يظهر عدم وجود نتائج في مرحلة معينة على أنه عدم وجود طلبات توصيل في المراحل الأخرى.</span>
      <div>
        <button type="button" onClick={() => onView("captains")}>جاهزية الكباتن ←</button>
        <button type="button" onClick={() => onView("coverage")}>التغطية الجغرافية ←</button>
        <button type="button" onClick={() => onView("attention")}>حالات التعثر ←</button>
      </div>
    </div>
    <p className="ops-dispatch-scope">{summary ? `القائمة مرتبطة بالمرحلة المختارة؛ عدد نتائج المصدر: ${summary.totalCount.toLocaleString("ar-YE")}.` :
      "بيانات مرحلة التوصيل غير متاحة حاليًا."} لا يتم عرض عدد عروض الإسناد أو أسباب عدم الأهلية دون دليل من المصدر.</p>
  </section>;
}
