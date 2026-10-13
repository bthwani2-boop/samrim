import { PageHeader } from "../../../../src/shell/page-header";
import { PartnerApprovalsNavigation } from "../../../../src/features/partner-onboarding/partner-approvals-navigation";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";
import { StoreAccessAdmissionQueue } from "../../../../src/features/store-access/store-access-admission-queue";

export default function PartnerStoreAccessPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partner-store-access-title">
        <PageHeader id="partner-store-access-title" title="الطلبات والاعتمادات" />
        <PartnerApprovalsNavigation current="store-access" />
        <StoreAccessAdmissionQueue />
      </section>
    </PartnerOperatorBoundary>
  );
}

export const metadata = { title: "الطلبات والاعتمادات — اعتماد الوصول" };
