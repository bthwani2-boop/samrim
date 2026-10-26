"use client";

import { Tabs } from "antd";
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
    <Tabs
      activeKey={queue}
      destroyOnHidden={false}
      onChange={(key) => {
        if (key === "cases" || key === "contacts" || key === "cancellations") setQueue(key);
      }}
      items={queues.map((item) => ({
        key: item.id,
        label: item.label,
        children: <div className="ops-decision-pane">
          <div className="ops-decision-description" role="status">{item.note}</div>
          {item.id === "cases" ? (
            <OperatorCaseInbox onOpenOrder={onOpenOrder} refreshVersion={refreshVersion} active={queue === "cases"} />
          ) : item.id === "contacts" ? (
            <CustomerContactQueue onOpenOrder={onOpenOrder} refreshVersion={refreshVersion} active={queue === "contacts"} />
          ) : (
            <CancellationRequestInbox onOpenOrder={onOpenOrder} refreshVersion={refreshVersion} active={queue === "cancellations"} />
          )}
        </div>,
      }))}
    />
  </section>;
}
