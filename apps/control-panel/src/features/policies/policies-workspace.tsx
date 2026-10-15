"use client";

import { PageHeader } from "../../shell/page-header";

import type { ReactNode } from "react";
import { useSession } from "../../session/session-provider";
import { type PolicyResourceKey, workspacePolicyResources } from "../../navigation/workspace-registry";
export function PoliciesWorkspace({ resource, children, embedded = false }: { resource: PolicyResourceKey; children: ReactNode; embedded?: boolean }) {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>مركز السياسات للمشغّلين</h1><p className="muted">القراءة والتعديل يمران عبر المالك القانوني لكل سياسة.</p></div></section>;
  }

  const canEdit = state.identity.permissions?.includes("platform_policies") === true && (resource !== "partner-financial-terms" || state.identity.permissions?.includes("finance") === true);
  const selected = workspacePolicyResources.find((item) => item.key === resource) ?? workspacePolicyResources[0]!;
  const restriction = !canEdit ? <p className="managed-status managed-status-warning" role="status">{resource === "partner-financial-terms" ? "تتطلب هذه السياسة صلاحية سياسات المنصة وصلاحية المالية من الحسابات." : "وضع قراءة فقط. يتطلب التعديل صلاحية سياسات المنصة من الحسابات."}</p> : null;
  if (embedded) return <>{restriction}{children}</>;
  return (
    <section className="workspace-page" aria-labelledby="policies-page-title">
      <PageHeader id="policies-page-title" title={selected.label} />
      {restriction}
      {children}
    </section>
  );
}
