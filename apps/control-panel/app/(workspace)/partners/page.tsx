"use client";

import { JoiningCaseQueue } from "../../../src/features/partner-onboarding/joining-case-queue";
import { PartnerOperatorBoundary, PartnerWorkspaceLinks } from "../../../src/features/partner-onboarding/partner-workspace";

export default function PartnersPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partners-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">إدارة انضمام الشركاء</p>
          <h1 id="partners-page-title">انضمام الشركاء</h1>
          <p className="lead">مساحة موارد مستقلة لطابور حالات الانضمام، مع تفاصيل الحالة ومدن الخدمة في مسارات منفصلة.</p>
        </div>
        <PartnerWorkspaceLinks active="queue" />
        <JoiningCaseQueue />
      </section>
    </PartnerOperatorBoundary>
  );
}
