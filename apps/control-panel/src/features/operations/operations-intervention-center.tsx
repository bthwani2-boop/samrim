"use client";

import { useState } from "react";
import { OperatorCaseInbox } from "./operator-case-inbox";
import { CustomerContactQueue } from "./customer-contact-queue";
import { CancellationRequestInbox } from "./cancellation-request-inbox";

type Queue = "cases" | "contacts" | "cancellations";
const queues: ReadonlyArray<{ id: Queue; label: string; note: string }> = [
  { id: "cases", label: "التعثر والتصعيد", note: "حالات العمل ومسؤولياتها وأدلة المعالجة" },
  { id: "contacts", label: "التحقق من العملاء", note: "المكالمات المطلوبة قبل تقدم الطلب" },
  { id: "cancellations", label: "طلبات الإلغاء", note: "قرارات تحتاج مراجعة المشغّل" },
];

export function OperationsInterventionCenter({ onOpenOrder, refreshVersion }: Readonly<{
  onOpenOrder: (orderId: string) => void;
  refreshVersion: number;
}>) {
  const [queue, setQueue] = useState<Queue>("cases");
  return <section className="ops-decision-center" data-testid="operations-interventions" aria-labelledby="ops-decision-title">
    <header className="ops-decision-heading">
      <div><h2 id="ops-decision-title">مركز القرارات التشغيلية</h2>
        <p>حدد نوع التدخل، ثم افتح الملف المرتبط لإجراء المراجعة المصرح بها دون مغادرة العمليات.</p></div>
      <span className="ops-decision-scope">قوائم المصدر المعتمد؛ ليست إحصاءً موحدًا لكل الحالات</span>
    </header>
    <fieldset className="ops-decision-switch"><legend className="visually-hidden">نوع التدخل</legend>
      {queues.map(item => <button type="button" key={item.id} onClick={() => setQueue(item.id)}
        className={queue === item.id ? "is-current" : ""} aria-pressed={queue === item.id}>
        {item.label}
      </button>)}
    </fieldset>
    <div className="ops-decision-description" role="status">{queues.find(item => item.id === queue)?.note}</div>
    {queue === "cases" ? <OperatorCaseInbox onOpenOrder={onOpenOrder} refreshVersion={refreshVersion} /> :
      queue === "contacts" ? <CustomerContactQueue onOpenOrder={onOpenOrder} refreshVersion={refreshVersion} /> :
      <CancellationRequestInbox onOpenOrder={onOpenOrder} refreshVersion={refreshVersion} />}
  </section>;
}
