"use client";

import { useSession } from "../../components/session-provider";

export default function WorkspacePage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  const isOwner = state.identity.role === "platform_owner";

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <div className="workspace-card">
        <div className="workspace-intro">
          <span className="success-badge"><span className="success-dot" aria-hidden="true" /> الجلسة نشطة</span>
          <p className="eyebrow">مساحة {isOwner ? "مالك المنصة" : "المشغل"}</p>
          <h1 id="workspace-title">أهلاً بك في مساحة العمل</h1>
          <p className="lead">تم توثيق جلستك بعاملين. من هنا تظهر فقط المسؤوليات المتاحة فعليًا لهذه المساحة.</p>
        </div>
        <div className="session-summary">
          <div><span className="summary-label">الدور الحالي</span><strong>{isOwner ? "مالك المنصة" : "موظف لوحة التحكم"}</strong></div>
          <div><span className="summary-label">السطح</span><strong>{state.identity.surface}</strong></div>
          <div><span className="summary-label">حالة الجلسة</span><strong className="summary-value-success">موثقة</strong></div>
        </div>
        <div className="workspace-note">
          <span className="note-mark" aria-hidden="true">✓</span>
          <div>
            <strong>الهوية جاهزة</strong>
            <p>لا توجد بيانات تشغيلية معروضة هنا قبل ربط صلاحيات الوحدات؛ لن نعرض أرقاماً تجريبية أو حالة غير مؤكدة.</p>
          </div>
        </div>
        <p className="workspace-page-context">أنت الآن في نظرة الهوية. استخدم التنقل للوصول إلى مسؤولية إدارة الحسابات والأدوار عندما يكون دورك مالك المنصة.</p>
      </div>
    </section>
  );
}
