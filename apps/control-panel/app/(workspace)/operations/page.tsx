"use client";

import { OperationsWorkspace } from "../../../src/features/operations/operations-workspace";
import { useSession } from "../../../src/session/session-provider";

export default function OperationsPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" aria-labelledby="operations-restricted-title"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1 id="operations-restricted-title">العمليات مقصورة على مشغلي لوحة التحكم</h1><p className="muted">تُحسم إجراءات التوزيع والاستعادة داخل المالك التشغيلي ولا تُمنح من الواجهة.</p></div></section>;
  }
  return (
    <section className="workspace-page" aria-labelledby="operations-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">مركز العمل الحالي</p>
        <h1 id="operations-page-title">العمليات</h1>
        <p className="lead">تابع دورة الطلب من الجاهزية إلى التسليم، واتخذ الإجراء الذي تسمح به الحالة الكانونية فقط.</p>
      </div>
      <OperationsWorkspace />
    </section>
  );
}
