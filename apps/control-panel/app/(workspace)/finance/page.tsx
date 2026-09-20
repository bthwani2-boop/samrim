"use client";

import { useSession } from "../../../src/session/session-provider";
import { CashCustodyWorkspace } from "../../../src/features/finance/cash-custody-workspace";

export default function FinancePage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" aria-labelledby="finance-restricted-title"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1 id="finance-restricted-title">المالية مقصورة على مشغلي لوحة التحكم</h1><p className="muted">تعرض هذه المساحة رصيد حفظ نقد COD التشغيلي فقط.</p></div></section>;
  }
  return (
    <section className="workspace-page" aria-labelledby="finance-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">قراءة مالية تشغيلية</p>
        <h1 id="finance-page-title">المالية</h1>
        <p className="lead">اعرض النقد المحصل عند الاستلام الذي ما زال في عهدة الكباتن. هذه القراءة لا تمثل تسوية تاجر أو عمولة أو دفعة منصة.</p>
      </div>
      <CashCustodyWorkspace />
    </section>
  );
}
