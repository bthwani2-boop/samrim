"use client";

import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";
import { StoreAccessAdmissionQueue } from "../../../../src/features/partner-onboarding/store-access-admission-queue";

export default function PartnerStoreAccessPage() {
  return <PartnerOperatorBoundary>
    <section className="workspace-page" aria-labelledby="partner-store-access-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">الشركاء / الوصول للمتاجر</p>
        <h1 id="partner-store-access-title">اعتماد وصول الشريك إلى متجر</h1>
        <p className="lead">تحقق من دعوة مالك المتجر واعتمد دور الشريك لحساب Identity الموجود فقط. قبول الدعوة يظل بيد المدعو.</p>
      </div>
      <StoreAccessAdmissionQueue />
    </section>
  </PartnerOperatorBoundary>;
}
