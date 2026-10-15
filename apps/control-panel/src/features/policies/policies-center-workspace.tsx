"use client";

import type { ReactNode } from "react";
import { LazyWorkspaceDisclosure } from "../shared/lazy-workspace-disclosure";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { ServiceCityPanel } from "../service-city/service-city-panel";
import { WalletProviderPolicyPanel } from "../wallet-provider/wallet-provider-policy-panel";
import { DeliveryFeePolicyWorkspace } from "../finance/delivery-fee-policy-workspace";
import { FieldAcquisitionPolicyWorkspace } from "../finance/field-acquisition-policy-workspace";
import { PartnerFinancialTermsPolicyWorkspace } from "../finance/partner-financial-terms-policy-workspace";
import { PoliciesWorkspace } from "./policies-workspace";
import type { PolicyResourceKey } from "../../navigation/workspace-registry";

function PolicyDisclosure({ resource, name, description, children, initiallyOpen = false }: Readonly<{
  resource: PolicyResourceKey;
  name: string;
  description: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}>) {
  return <LazyWorkspaceDisclosure name={name} description={description} initiallyOpen={initiallyOpen}>
    <PoliciesWorkspace embedded resource={resource}>{children}</PoliciesWorkspace>
  </LazyWorkspaceDisclosure>;
}

export function PoliciesCenterWorkspace() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" role="alert">
      <h1>السياسات للمشغلين فقط</h1>
      <p>لا تمنح هذه الصفحة صلاحيات قراءة أو تعديل إضافية.</p>
    </section>;
  }
  return <section className="workspace-page policies-center" aria-labelledby="policies-center-title">
    <PageHeader id="policies-center-title" title="سياسات المنصة" />
    <p className="muted">اختر السياسة داخل هذه الصفحة. تُحفظ صلاحيات كل سياسة وسجلها المعتمد دون إنشاء إعدادات موازية.</p>
    <PolicyDisclosure resource="service-cities" name="مدن الخدمة" description="المدن المعتمدة ونطاق توفير الخدمة" initiallyOpen>
      <ServiceCityPanel />
    </PolicyDisclosure>
    <PolicyDisclosure resource="wallet-providers" name="مزودو المحافظ" description="القائمة الرسمية لوسائل المحفظة">
      <WalletProviderPolicyPanel />
    </PolicyDisclosure>
    <PolicyDisclosure resource="delivery-fees" name="رسوم التوصيل" description="السياسات المستخدمة في التسعير الخادمي">
      <DeliveryFeePolicyWorkspace />
    </PolicyDisclosure>
    <PolicyDisclosure resource="field-acquisition" name="مكافآت استقطاب الميدان" description="استحقاق ضم الشركاء بحسب نوع المتجر">
      <FieldAcquisitionPolicyWorkspace />
    </PolicyDisclosure>
    <PolicyDisclosure resource="partner-financial-terms" name="شروط الشركاء المالية" description="العمولة والتسوية؛ تتطلب أيضًا صلاحية المالية">
      <PartnerFinancialTermsPolicyWorkspace />
    </PolicyDisclosure>
  </section>;
}
