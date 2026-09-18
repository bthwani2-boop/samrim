"use client";

import { JoiningCaseCreate } from "../../../../src/features/partner-onboarding/joining-case-create";
import { PartnerOperatorBoundary, PartnerWorkspaceLinks } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function NewPartnerCasePage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="new-partner-case-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">الشركاء والمتاجر / إنشاء</p>
          <h1 id="new-partner-case-page-title">إنشاء حالة انضمام</h1>
          <p className="lead">أنشئ سجل DSH الكانوني ثم انتقل إلى تفاصيله لقراءة النسخة وتنفيذ العملية المتاحة.</p>
        </div>
        <PartnerWorkspaceLinks active="new" />
        <JoiningCaseCreate />
      </section>
    </PartnerOperatorBoundary>
  );
}
