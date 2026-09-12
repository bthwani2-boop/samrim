"use client";

import { PartnerBootstrapPanel } from "../../components/partner-bootstrap-panel";
import { useSession } from "../../components/session-provider";

export default function PartnersPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" && state.identity.role !== "platform_owner") {
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
        <p className="eyebrow">DSH · J2.1</p>
        <h1 id="partners-page-title">تهيئة الشركاء</h1>
        <p className="lead">أدخل رقم هاتف الشريك واسم متجره الأول؛ يحدد Identity معرّف <code>actor_id</code> الموثوق ويربط DSH المتجر الأول بالشريك مباشرةً.</p>
      </div>
      <PartnerBootstrapPanel />
    </section>
  );
}
