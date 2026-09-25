"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "../../session/session-provider";
import { type FinanceResourceKey, workspaceFinanceResources } from "../../navigation/workspace-registry";
import { WorkspaceResourceIndex } from "../workspace/workspace-resource-index";

function resourceForPath(pathname: string): FinanceResourceKey {
  if (pathname === "/finance") return "overview";
  return workspaceFinanceResources.find((resource) => resource.href !== "/finance" && (pathname === resource.href || pathname.startsWith(`${resource.href}/`)))?.key ?? "overview";
}

function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>صلاحية المالية غير متاحة</h1>
        <p className="muted">يتطلب فتح هذه المساحة صلاحية Finance الممنوحة لهذا الموظف في Identity.</p>
      </div>
    </section>
  );
}

export function FinanceWorkspace({ resource, children }: { resource: FinanceResourceKey; children: ReactNode }) {
  const { state } = useSession();
  const pathname = usePathname() ?? "/finance";
  const activeResource = resource === "overview" ? resourceForPath(pathname) : resource;

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("finance")) return accessDenied();

  const selected = workspaceFinanceResources.find((item) => item.key === activeResource) ?? workspaceFinanceResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="finance-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">الحقيقة والسياسات المالية الكانونية</p>
        <h1 id="finance-page-title">{selected.key === "overview" ? "المالية" : selected.label}</h1>
        <p className="lead">{selected.description}</p>
      </div>
      {children}
    </section>
  );
}

export function FinanceOverview() {
  return (
    <WorkspaceResourceIndex
      title="موارد المالية"
      description="افتح السجل أو السياسة التي تعمل عليها. تبقى الأرصدة والإجراءات من WLT هي الحقيقة المعتمدة."
      resources={workspaceFinanceResources.slice(1)}
    />
  );
}
