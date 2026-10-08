"use client";

import { JoiningCaseCreate } from "../../../../src/features/partner-onboarding/joining-case-create";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function NewPartnerCasePage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="new-partner-case-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">الشركاء / إنشاء</p>
          <h1 id="new-partner-case-page-title">إنشاء حالة انضمام</h1>
          <p className="lead">أنشئ سجل الشريك ثم انتقل إلى تفاصيله لمراجعة حالته وتنفيذ العملية المتاحة.</p>
        </div>
        <JoiningCaseCreate />
      </section>
    </PartnerOperatorBoundary>
  );
}
