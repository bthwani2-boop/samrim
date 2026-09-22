"use client";

import MarketingWorkspace from "../../../src/features/marketing/marketing-workspace";

export default function MarketingPage() {
  return <section className="workspace-page" aria-labelledby="marketing-page-title"><div className="workspace-page-heading"><p className="eyebrow">إدارة النمو</p><h1 id="marketing-page-title">العروض والاكتشاف</h1><p className="lead">امتلك العروض والمحتوى من Control، ودع DSH يقرر الأهلية والنشر والخصم.</p></div><MarketingWorkspace /></section>;
}
