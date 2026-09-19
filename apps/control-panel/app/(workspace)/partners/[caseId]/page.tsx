"use client";

import { useParams } from "next/navigation";
import { JoiningCaseDetail } from "../../../../src/features/partner-onboarding/joining-case-detail";
import { PartnerOperatorBoundary, PartnerWorkspaceLinks } from "../../../../src/features/partner-onboarding/partner-workspace";

export default function PartnerCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partner-case-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">الشركاء والمتاجر / حالة انضمام</p>
          <h1 id="partner-case-page-title">تفاصيل حالة الانضمام</h1>
          <p className="lead">اقرأ الحالة الحالية ثم نفذ العملية المسموحة فقط باستخدام النسخة المقروءة.</p>
        </div>
        <PartnerWorkspaceLinks active="detail" />
        {caseId ? <JoiningCaseDetail caseId={caseId} /> : <p className="identity-error" role="alert">معرّف الحالة غير صالح.</p>}
      </section>
    </PartnerOperatorBoundary>
  );
}
