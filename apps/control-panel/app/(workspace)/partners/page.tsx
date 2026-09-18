"use client";

import { JoiningCasePanel } from "../../../src/features/partner-onboarding/joining-case-panel";
import { ServiceCityPanel } from "../../../src/features/service-city/service-city-panel";
import { useSession } from "../../../src/session/session-provider";

export default function PartnersPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return (
      <section className="state-content workspace-restricted" aria-labelledby="partners-restricted-title">
        <div className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">صلاحية غير متاحة</p>
        <h1 id="partners-restricted-title">الشركاء والمتاجر مقصورة على مشغلي لوحة التحكم</h1>
          <p className="muted">هذه المساحة لا تمنح صلاحيات إضافية خارج دور Identity الموثق.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="workspace-page" aria-labelledby="partners-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة انضمام الشركاء</p>
        <h1 id="partners-page-title">انضمام الشركاء</h1>
        <p className="lead">أنشئ حالة انضمام للشريك، ثم أرسلها للمراجعة حتى تُربط هوية الشريك بالمتجر المعتمد.</p>
      </div>
      <JoiningCasePanel />
      <ServiceCityPanel />
    </section>
  );
}
