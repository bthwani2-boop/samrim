"use client";

import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { MarketingPromotionsWorkspace } from "./marketing-promotions-workspace";
import { MarketingContentWorkspace } from "./marketing-content-workspace";

export function MarketingCenterWorkspace() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" role="alert">
      <h1>التسويق للمشغلين فقط</h1>
      <p>لا يمنح الدخول إلى هذا المركز صلاحيات إضافية.</p>
    </section>;
  }

  return <section className="workspace-page marketing-center" aria-labelledby="marketing-center-title">
    <PageHeader id="marketing-center-title" title="التسويق والمحتوى" />
    <p className="muted">العروض والمحتوى في مساحة واحدة. إنشاء المسودات والإدارة والتحليلات في مكانها، دون انتقال إلى صفحات منفصلة.</p>
    <nav aria-label="انتقل إلى سجل التسويق" className="action-row">
      <a className="button button-secondary" href="#marketing-center-promotions">العروض والحملات</a>
      <a className="button button-secondary" href="#marketing-center-content">البنرات والمحتوى</a>
    </nav>
    <section id="marketing-center-promotions" className="marketing-center-resource" aria-labelledby="marketing-center-promotions-heading">
      <h2 id="marketing-center-promotions-heading">العروض والحملات</h2>
      <MarketingPromotionsWorkspace />
    </section>
    <section id="marketing-center-content" className="marketing-center-resource" aria-labelledby="marketing-center-content-heading">
      <h2 id="marketing-center-content-heading">البنرات ومحتوى الاكتشاف</h2>
      <MarketingContentWorkspace />
    </section>
  </section>;
}
