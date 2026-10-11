import { PageHeader } from "../../../../src/shell/page-header";
import { JoiningCaseQueue } from "../../../../src/features/partner-onboarding/joining-case-queue";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function PartnerJoiningPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page partner-joining-page" aria-labelledby="partner-joining-page-title">
        <PageHeader id="partner-joining-page-title" title="طلبات انضمام الشركاء" />
        <JoiningCaseQueue />
      </section>
    </PartnerOperatorBoundary>
  );
}

export const metadata = { title: "طلبات الانضمام" };
