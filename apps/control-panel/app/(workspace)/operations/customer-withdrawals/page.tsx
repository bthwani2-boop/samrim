"use client";

import { PageHeader } from "../../../../src/shell/page-header";

import { CustomerWithdrawalIntake } from "../../../../src/features/operations/customer-withdrawal-intake";
import { useSession } from "../../../../src/session/session-provider";

export default function OperationsCustomerWithdrawalsPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("operations")) return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><PageHeader title="صلاحية العمليات غير متاحة" /><p className="muted">يتطلب تسجيل الطلب تفويضاً من مشغل مخول.</p></div></section>;
  return <section className="workspace-page" aria-labelledby="customer-withdrawal-ops-title"><PageHeader id="customer-withdrawal-ops-title" title="طلبات سحب العملاء الاستثنائية" /><CustomerWithdrawalIntake /></section>;
}
