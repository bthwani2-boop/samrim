"use client";

import { useSession } from "../../../src/session/session-provider";
import { CashCustodyWorkspace } from "../../../src/features/finance/cash-custody-workspace";
import { DeliveryFeePolicyWorkspace } from "../../../src/features/finance/delivery-fee-policy-workspace";
import { FieldCommissionPolicyWorkspace } from "../../../src/features/finance/field-commission-policy-workspace";
import { PartnerEarningsWorkspace } from "../../../src/features/finance/partner-earnings-workspace";
import { PartnerSettlementWorkspace } from "../../../src/features/finance/partner-settlement-workspace";

export default function FinancePage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" aria-labelledby="finance-restricted-title"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1 id="finance-restricted-title">المالية مقصورة على مشغلي لوحة التحكم</h1><p className="muted">تعرض هذه المساحة رصيد حفظ نقد COD التشغيلي فقط.</p></div></section>;
  }
  return (
    <section className="workspace-page" aria-labelledby="finance-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">قراءة وسياسات مالية مملوكة لـ WLT</p>
        <h1 id="finance-page-title">المالية</h1>
        <p className="lead">اعرض الحقيقة المالية المحسوبة خادميًا واضبط السياسات المسموح بها من لوحة التحكم. لا تنشئ هذه المساحة أرصدة أو عمولات أو تسويات يدوية.</p>
      </div>
      <CashCustodyWorkspace />
      <DeliveryFeePolicyWorkspace />
      <FieldCommissionPolicyWorkspace />
      <PartnerEarningsWorkspace />
      <PartnerSettlementWorkspace />
    </section>
  );
}
