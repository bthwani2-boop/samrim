"use client";

import { AccountAccessPanel } from "../../components/account-access-panel";
import { useSession } from "../../components/session-provider";

export default function AccessPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;

  if (state.identity.role !== "platform_owner") {
    return (
      <section className="state-content workspace-restricted" aria-labelledby="access-restricted-title">
        <div className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">صلاحية غير متاحة</p>
          <h1 id="access-restricted-title">إدارة الوصول مقصورة على مالك المنصة</h1>
          <p className="muted">هذه المساحة لا تمنح صلاحيات إضافية للموظف. اطلب التفويض عبر المسار الإداري المعتمد.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-page" aria-labelledby="access-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة الوصول</p>
        <h1 id="access-page-title">الحسابات والأدوار</h1>
        <p className="lead">إدارة الوصول الحالية مرتبطة بمالكي Identity وDSH؛ تعرض هذه الصفحة الحالة الكانونية وتقرأها بعد كل تغيير.</p>
      </div>
      <AccountAccessPanel />
    </section>
  );
}
