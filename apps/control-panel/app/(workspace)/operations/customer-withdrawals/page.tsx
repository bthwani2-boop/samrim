"use client";

import { CustomerWithdrawalIntake } from "../../../../src/features/operations/customer-withdrawal-intake";
import { useSession } from "../../../../src/session/session-provider";

export default function OperationsCustomerWithdrawalsPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("operations")) return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><h1>صلاحية العمليات غير متاحة</h1><p className="muted">يتطلب تسجيل الطلب تفويضاً من مشغل مخول في Identity.</p></div></section>;
  return <section className="workspace-page" aria-labelledby="customer-withdrawal-ops-title"><div className="workspace-page-heading"><p className="eyebrow">طلب داخلي غير ذاتي</p><h1 id="customer-withdrawal-ops-title">طلبات سحب العملاء الاستثنائية</h1><p className="lead">تسجل العمليات طلب العميل ومستند التفويض. لا تنفذ هذه الشاشة تحويلاً ولا تغير رصيد WLT؛ تنتقل المعاملة بعد التسجيل إلى مراجعة المالية.</p></div><CustomerWithdrawalIntake /></section>;
}
