"use client";

import Link from "next/link";
import { PartnerDirectory } from "../../../src/features/partner-onboarding/partner-directory";
import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";
import "../../../src/features/partner-onboarding/partner-directory.module.css";

export default function PartnersPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partners-page-title">
        <div className="workspace-page-heading partner-page-heading">
          <div className="workspace-page-heading-copy">
            <p className="eyebrow">إدارة الشركاء</p>
            <h1 id="partners-page-title">الشركاء</h1>
            <p className="lead">حسابات الشركاء المقبولين من Identity وحالات الانضمام من DSH.</p>
          </div>
          <Link className="button button-primary" href="/partners/new">إضافة شريك</Link>
        </div>
        <PartnerDirectory />
      </section>
    </PartnerOperatorBoundary>
  );
}
