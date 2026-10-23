"use client";

import { PageHeader } from "../../../src/shell/page-header";

import { OperationsWorkspace } from "../../../src/features/operations/operations-workspace";
import { useSession } from "../../../src/session/session-provider";

export default function OperationsPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" aria-labelledby="operations-restricted-title"><div className="state-card" role="alert"><PageHeader id="operations-restricted-title" title="العمليات غير متاحة" /><p className="muted">يتطلب الوصول حساب مشغّل مخوّل.</p></div></section>;
  }
  return (
    <section className="workspace-page" aria-labelledby="operations-page-title">
      <OperationsWorkspace />
    </section>
  );
}
