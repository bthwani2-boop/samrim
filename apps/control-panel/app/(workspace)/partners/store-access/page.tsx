import { PageHeader } from "../../../../src/shell/page-header";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";
import { StoreAccessAdmissionQueue } from "../../../../src/features/partner-onboarding/store-access-admission-queue";

export default function PartnerStoreAccessPage() {
  return <PartnerOperatorBoundary>
    <section className="workspace-page" aria-labelledby="partner-store-access-title">
      <PageHeader id="partner-store-access-title" title="اعتماد وصول الشريك إلى متجر" />
      <StoreAccessAdmissionQueue />
    </section>
  </PartnerOperatorBoundary>;
}

export const metadata = { title: "اعتماد وصول المتاجر" };
