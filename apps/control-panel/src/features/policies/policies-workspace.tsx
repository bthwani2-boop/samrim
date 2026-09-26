"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "../../session/session-provider";
import { type PolicyResourceKey, workspacePolicyResources } from "../../navigation/workspace-registry";
import { WorkspaceResourceIndex } from "../workspace/workspace-resource-index";

function resourceForPath(pathname: string): PolicyResourceKey {
  return workspacePolicyResources.find((resource) => resource.href !== "/policies" && (pathname === resource.href || pathname.startsWith(`${resource.href}/`)))?.key ?? "overview";
}
export function PoliciesWorkspace({ resource, children }: { resource: PolicyResourceKey; children?: ReactNode }) {
  const { state } = useSession();
  const pathname = usePathname() ?? "/policies";
  const activeResource = resource === "overview" ? resourceForPath(pathname) : resource;
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>مركز السياسات للمشغّلين</h1><p className="muted">القراءة والتعديل يمران عبر المالك القانوني لكل سياسة.</p></div></section>;
  }

  const canEdit = state.identity.permissions?.includes("platform_policies") === true && (activeResource !== "partner-financial-terms" || state.identity.permissions?.includes("finance") === true);
  const selected = workspacePolicyResources.find((item) => item.key === activeResource) ?? workspacePolicyResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="policies-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">السياسات · DSH وWLT</p>
        <h1 id="policies-page-title">{selected.key === "overview" ? "مركز السياسات" : selected.label}</h1>
        <p className="lead">{selected.description}</p>
      </div>
      {!canEdit ? <p className="managed-status managed-status-warning" role="status">{activeResource === "partner-financial-terms" ? "تتطلب هذه السياسة صلاحية سياسات المنصة وصلاحية Finance من Identity." : "وضع قراءة فقط. يتطلب التعديل صلاحية سياسات المنصة من Identity."}</p> : null}
      {children ?? <WorkspaceResourceIndex
        title="سياسات المنصة"
        description="تُقرأ السياسة من المالك القانوني وتُحفظ لديه؛ الشارة توضح المالك قبل الدخول."
        resources={workspacePolicyResources.slice(1).map((item) => ({
          ...item,
          source: item.key === "delivery-fees" || item.key === "field-rewards" || item.key === "partner-financial-terms" ? "WLT" : "DSH",
        }))}
      />}
    </section>
  );
}
