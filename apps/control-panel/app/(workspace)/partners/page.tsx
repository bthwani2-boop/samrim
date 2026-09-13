"use client";

import { JoiningCasePanel } from "../../../src/features/partner-onboarding/joining-case-panel";
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
          <h1 id="partners-restricted-title">تهيئة الشركاء مقصورة على مشغلي لوحة التحكم</h1>
          <p className="muted">هذه المساحة لا تمنح صلاحيات إضافية خارج دور Identity الموثق.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="workspace-page" aria-labelledby="partners-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">DSH · J1</p>
        <h1 id="partners-page-title">انضمام الشركاء</h1>
        <p className="lead">أنشئ حالة انضمام يملكها DSH، ثم أرسلها للمراجعة حتى يحل Identity actor الشريك ويربط Store القانوني بالحالة المعتمدة.</p>
      </div>
      <JoiningCasePanel />
    </section>
  );
}
