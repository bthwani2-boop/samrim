"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "../../session/session-provider";
import "./catalog-workspace.module.css";

const catalogResources = [
  { key: "overview", href: "/catalog", label: "نظرة عامة", description: "اختر مساحة الكتالوج المطلوبة." },
  { key: "products", href: "/catalog/products", label: "المنتجات", description: "هوية المنتج ونسخه المركزية." },
  { key: "categories", href: "/catalog/categories", label: "التصنيفات", description: "تصنيفات المنتجات التابعة للمجالات." },
  { key: "verticals", href: "/catalog/verticals", label: "المجالات", description: "قاموس المجالات التجارية." },
  { key: "proposals", href: "/catalog/proposals", label: "المقترحات", description: "طابور مراجعة مقترحات الشركاء." },
  { key: "import", href: "/catalog/import", label: "الاستيراد", description: "ملف مصدر آمن، معاينة، ثم التزام." },
] as const;

export type CatalogResourceKey = (typeof catalogResources)[number]["key"];

function resourceForPath(pathname: string): CatalogResourceKey {
  if (pathname === "/catalog") return "overview";
  return catalogResources.find((resource) => resource.href !== "/catalog" && pathname.startsWith(resource.href))?.key ?? "overview";
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

  const selected = catalogResources.find((item) => item.key === resource) ?? catalogResources[0];
  return (
    <section className="workspace-page" aria-labelledby="catalog-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة الكتالوج</p>
        <h1 id="catalog-page-title">{selected.label === "نظرة عامة" ? "الكتالوج" : selected.label}</h1>
        <p className="lead">{selected.description}</p>
      </div>
      <nav aria-label="موارد الكتالوج" className="catalog-resource-nav">
        <ul>
          {catalogResources.map((item) => (
            <li key={item.key}>
              <a href={item.href} aria-current={activeResource === item.key ? "page" : undefined}>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </a>
            </li>
          ))}
        </ul>
      </nav>
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
      <div className="catalog-resource-cards">
        {catalogResources.slice(1).map((item) => (
          <a className="access-card" href={item.href} key={item.key}>
            <span className="step-chip">مساحة عمل</span>
            <h3>{item.label}</h3>
            <p className="muted">{item.description}</p>
            <span className="button button-secondary">فتح المساحة</span>
          </a>
        ))}
      </div>
    </section>
  );
}
