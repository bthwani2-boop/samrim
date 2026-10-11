"use client";

import { PageHeader } from "../../shell/page-header";

import type { ReactNode } from "react";
import { useSession } from "../../session/session-provider";
import { type FinanceResourceKey, workspaceFinanceResources } from "../../navigation/workspace-registry";

function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>صلاحية المالية غير متاحة</h1>
        <p className="muted">يتطلب فتح هذه المساحة صلاحية المالية الممنوحة لهذا الموظف في الحسابات.</p>
      </div>
    </section>
  );
}

export function FinanceWorkspace({ resource, children }: { resource: FinanceResourceKey; children: ReactNode }) {
  const { state } = useSession();

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("finance")) return accessDenied();

  const selected = workspaceFinanceResources.find((item) => item.key === resource) ?? workspaceFinanceResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="finance-page-title">
      <PageHeader id="finance-page-title" title={selected.label} />
      {children}
    </section>
  );
}
