import Link from "next/link";
import { PageHeader } from "../../../../src/shell/page-header";
import { JoiningCaseQueue } from "../../../../src/features/partner-onboarding/joining-case-queue";
import { PartnerApprovalsNavigation } from "../../../../src/features/partner-onboarding/partner-approvals-navigation";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function PartnerJoiningPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page partner-joining-page" aria-labelledby="partner-joining-page-title">
        <PageHeader id="partner-joining-page-title" title="الطلبات والاعتمادات" actions={<Link className="button button-primary" href="/partners/new">طلب انضمام جديد</Link>} />
        <PartnerApprovalsNavigation current="joining" />
        <JoiningCaseQueue />
      </section>
    </PartnerOperatorBoundary>
  );
}

export const metadata = { title: "الطلبات والاعتمادات" };
