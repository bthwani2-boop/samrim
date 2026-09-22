"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../../session/session-provider";
import { type FinanceResourceKey, workspaceFinanceResources } from "../../navigation/workspace-registry";

function resourceForPath(pathname: string): FinanceResourceKey {
  if (pathname === "/finance") return "overview";
  return workspaceFinanceResources.find((resource) => resource.href !== "/finance" && (pathname === resource.href || pathname.startsWith(`${resource.href}/`)))?.key ?? "overview";
}

function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>المالية للمشغلين فقط</h1>
        <p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p>
      </div>
    </section>
  );
}

export function FinanceWorkspace({ resource, children }: { resource: FinanceResourceKey; children: ReactNode }) {
  const { state } = useSession();
  const pathname = usePathname() ?? "/finance";
  const activeResource = resource === "overview" ? resourceForPath(pathname) : resource;

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return accessDenied();

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
    <section className="access-card" aria-labelledby="finance-overview-title">
      <div className="access-card-heading">
        <span className="step-chip">موارد مستقلة</span>
        <p className="eyebrow">نقطة البدء</p>
        <h2 id="finance-overview-title">اختر مورد المالية</h2>
        <p className="muted">كل مورد يقرأ إسقاطه أو سياسته القانونية ويعرض حالات التحميل والفراغ والخطأ قبل أي إجراء.</p>
      </div>
      <div className="workspace-resource-cards">
        {workspaceFinanceResources.slice(1).map((item) => (
          <Link className="access-card" href={item.href} key={item.key}>
            <span className="step-chip">مساحة عمل</span>
            <h3>{item.label}</h3>
            <p className="muted">{item.description}</p>
            <span className="button button-secondary">فتح المساحة</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
