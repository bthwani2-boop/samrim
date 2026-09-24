"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../../session/session-provider";
import { type CatalogResourceKey, workspaceCatalogResources } from "../../navigation/workspace-registry";
import "./catalog-workspace.module.css";

function resourceForPath(pathname: string): CatalogResourceKey {
  if (pathname === "/catalog") return "overview";
  return workspaceCatalogResources.find((resource) => resource.href !== "/catalog" && (pathname === resource.href || pathname.startsWith(`${resource.href}/`)))?.key ?? "overview";
}

function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>الكتالوج للمشغلين فقط</h1>
        <p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p>
      </div>
    </section>
  );
}

export function CatalogWorkspace({ resource, children }: { resource: CatalogResourceKey; children: ReactNode }) {
  const { state } = useSession();
  const pathname = usePathname();
  const activeResource = resource === "overview" ? resourceForPath(pathname) : resource;

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return accessDenied();
  if (!state.identity.permissions?.includes("catalog")) return accessDenied();

  const selected = workspaceCatalogResources.find((item) => item.key === activeResource) ?? workspaceCatalogResources[0];
  return (
    <section className="workspace-page" aria-labelledby="catalog-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة الكتالوج</p>
        <h1 id="catalog-page-title">{selected.label === "نظرة عامة" ? "الكتالوج" : selected.label}</h1>
        <p className="lead">{selected.description}</p>
      </div>
      {children}
    </section>
  );
}

export function CatalogOverview() {
  return (
    <section className="access-card" aria-labelledby="catalog-overview-title">
      <div className="access-card-heading">
        <span className="step-chip">مساحات مستقلة</span>
        <p className="eyebrow">نقطة البدء</p>
        <h2 id="catalog-overview-title">اختر مورد الكتالوج</h2>
        <p className="muted">كل مساحة تقرأ موردها القانوني وتعرض حالات التحميل والفراغ والخطأ قبل أي إجراء.</p>
      </div>
      <div className="workspace-resource-cards">
        {workspaceCatalogResources.slice(1).map((item) => (
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
