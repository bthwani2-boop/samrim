"use client";

import { PageHeader } from "../../../../src/shell/page-header";

import { useParams } from "next/navigation";
import { JoiningCaseDetail } from "../../../../src/features/partner-onboarding/joining-case-detail";
import { PartnerOperatorBoundary } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function PartnerCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partner-case-page-title">
        <PageHeader id="partner-case-page-title" title="تفاصيل حالة الانضمام" />
        {caseId ? <JoiningCaseDetail caseId={caseId} /> : <p className="identity-error" role="alert">معرّف الحالة غير صالح.</p>}
      </section>
    </PartnerOperatorBoundary>
  );
}
