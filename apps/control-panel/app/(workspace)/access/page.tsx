"use client";

import { Suspense } from "react";
import { AccessCenterWorkspace } from "../../../src/features/access/access-center-workspace";
import { PageHeader } from "../../../src/shell/page-header";

export default function AccessPage() {
  return <section className="workspace-page access-page" aria-labelledby="access-page-title">
    <PageHeader id="access-page-title" title="الوصول والصلاحيات" />
    <Suspense fallback={<p className="access-loading" role="status">جارٍ تحميل الوصول والصلاحيات…</p>}>
      <AccessCenterWorkspace />
    </Suspense>
  </section>;
}
