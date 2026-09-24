"use client";

import { JoiningCaseQueue } from "../../../../src/features/partner-onboarding/joining-case-queue";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function PartnerJoiningPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partner-joining-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">الشركاء / الانضمام</p>
          <h1 id="partner-joining-page-title">طلبات انضمام الشركاء</h1>
          <p className="lead">راجع الحالات الواردة وافتح كل حالة لتنفيذ قرارها من سجل DSH الكانوني.</p>
        </div>
        <JoiningCaseQueue />
      </section>
    </PartnerOperatorBoundary>
  );
}
