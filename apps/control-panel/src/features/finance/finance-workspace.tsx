"use client";

import { PageHeader } from "../../shell/page-header";

import Link from "next/link";
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
  const isSettlement = resource.startsWith("beneficiary-settlement-");
  return (
    <section className="workspace-page" aria-labelledby="finance-page-title">
      <PageHeader id="finance-page-title" title={isSettlement ? "المستحقات والتسويات" : selected.label} />
      {isSettlement ? (
        <nav className="detail-tabs" aria-label="نوع المستفيد">
          {workspaceFinanceResources.filter((item) => item.key.startsWith("beneficiary-settlement-")).map((item) => (
            <Link key={item.key} href={item.href} aria-current={item.key === resource ? "page" : undefined}>
              {item.label.replace("مستحقات ", "")}
            </Link>
          ))}
        </nav>
      ) : null}
      {children}
    </section>
  );
}
