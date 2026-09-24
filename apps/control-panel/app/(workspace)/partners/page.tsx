"use client";

import { JoiningCaseQueue } from "../../../src/features/partner-onboarding/joining-case-queue";
import { PartnerDirectory } from "../../../src/features/partner-onboarding/partner-directory";
import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";

export default function PartnersPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partners-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">إدارة الشركاء والميدان</p>
          <h1 id="partners-page-title">الشركاء وممثلو الميدان</h1>
          <p className="lead">يعرض هذا المركز سجل الشركاء المقبولين وطابور انضمامهم، وتوجد إدارة الممثلين الميدانيين في وجهة الميدان التابعة له.</p>
        </div>
        <PartnerDirectory />
        <JoiningCaseQueue />
      </section>
    </PartnerOperatorBoundary>
  );
}
