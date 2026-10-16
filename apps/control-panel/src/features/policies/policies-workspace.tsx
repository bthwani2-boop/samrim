"use client";

import type { ReactNode } from "react";
import { useSession } from "../../session/session-provider";
import { canManagePolicy, type PolicyResourceKey } from "./policy-capabilities";

/** The sole policy editor adapter: keeps existing owner editors, not a second administration page. */
export function PoliciesWorkspace({ resource, children }: Readonly<{ resource: PolicyResourceKey; children: ReactNode }>) {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="state-content workspace-restricted" role="alert">
      <h1>مركز السياسات للمشغّلين</h1>
      <p className="muted">تُدار كل سياسة عبر الخدمة المالكة وصلاحيات الحساب.</p>
    </section>;
  }

  const canEdit = canManagePolicy(resource, state.identity.permissions);
  return <>
    {!canEdit ? <p className="managed-status managed-status-warning" role="status">
      {resource === "partner-financial-terms"
        ? "تتطلب هذه السياسة صلاحية سياسات المنصة وصلاحية المالية معًا."
        : "وضع قراءة فقط؛ التعديل يتطلب صلاحية سياسات المنصة."}
    </p> : null}
    {children}
  </>;
}
