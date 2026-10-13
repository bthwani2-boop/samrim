import { PageHeader } from "../../../../src/shell/page-header";
import { JoiningCaseCreate } from "../../../../src/features/partner-onboarding/joining-case-create";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function NewPartnerCasePage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="new-partner-case-page-title">
        <PageHeader id="new-partner-case-page-title" title="طلب انضمام جديد" />
        <JoiningCaseCreate />
      </section>
    </PartnerOperatorBoundary>
  );
}

export const metadata = { title: "طلب انضمام جديد" };
