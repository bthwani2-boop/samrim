"use client";

import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { MarketingPromotionsWorkspace } from "./marketing-promotions-workspace";
import { MarketingContentWorkspace } from "./marketing-content-workspace";
import { LazyWorkspaceDisclosure } from "../shared/lazy-workspace-disclosure";

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
    <div className="work-stack">
    <LazyWorkspaceDisclosure name="العروض والحملات" description="إدارة النشر والتمويل ونتائج العروض" initiallyOpen>
      <MarketingPromotionsWorkspace />
    </LazyWorkspaceDisclosure>
    <LazyWorkspaceDisclosure name="البنرات ومحتوى الاكتشاف" description="إدارة المحتوى وظهوره ونتائجه">
      <MarketingContentWorkspace />
    </LazyWorkspaceDisclosure>
    </div>
  </section>;
}
