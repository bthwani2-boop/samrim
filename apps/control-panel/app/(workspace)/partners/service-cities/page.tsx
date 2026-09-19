"use client";

import { PartnerOperatorBoundary, PartnerWorkspaceLinks } from "../../../../src/features/partner-onboarding/partner-workspace";
import { ServiceCityPanel } from "../../../../src/features/service-city/service-city-panel";

export default function PartnerServiceCitiesPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partner-service-cities-page-title">
        <div className="workspace-page-heading">
          <p className="eyebrow">الشركاء والمتاجر / الإعداد</p>
          <h1 id="partner-service-cities-page-title">مدن الخدمة</h1>
          <p className="lead">مساحة إعداد مستقلة للمدن الكانونية التي تعتمد عليها حالات الانضمام وأهلية المتاجر.</p>
        </div>
        <PartnerWorkspaceLinks active="cities" />
        <ServiceCityPanel />
      </section>
    </PartnerOperatorBoundary>
  );
}
