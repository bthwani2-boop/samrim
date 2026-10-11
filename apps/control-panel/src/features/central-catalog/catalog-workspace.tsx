"use client";

import { PageHeader } from "../../shell/page-header";

import type { ReactNode } from "react";
import { useSession } from "../../session/session-provider";
import { type CatalogResourceKey, workspaceCatalogResources } from "../../navigation/workspace-registry";
function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>الكتالوج للمشغلين فقط</h1>
        <p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج الحسابات.</p>
      </div>
    </section>
  );
}

export function CatalogWorkspace({ resource, children }: { resource: CatalogResourceKey; children: ReactNode }) {
  const { state } = useSession();

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return accessDenied();
  if (resource === "trash") {
    if (!state.identity.permissions?.some((permission) => permission === "catalog" || permission === "partners")) return accessDenied();
  } else if (!state.identity.permissions?.includes("catalog")) return accessDenied();

  const selected = workspaceCatalogResources.find((item) => item.key === resource) ?? workspaceCatalogResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="catalog-page-title">
      <PageHeader id="catalog-page-title" title={selected.label} />
      {children}
    </section>
  );
}
