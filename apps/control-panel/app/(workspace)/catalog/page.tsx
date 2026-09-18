"use client";

import { CentralCatalog } from "../../../src/features/central-catalog/central-catalog";
import { CatalogCategoryRegistry } from "../../../src/features/central-catalog/catalog-category-registry";
import { CatalogVerticalRegistry } from "../../../src/features/central-catalog/catalog-vertical-registry";
import { CatalogGovernancePanel } from "../../../src/features/central-catalog/catalog-governance-panel";
import { useSession } from "../../../src/session/session-provider";

export default function CentralCatalogPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>الكتالوج للمشغلين فقط</h1><p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p></div></section>;
  return <section className="workspace-page" aria-labelledby="catalog-page-title"><div className="workspace-page-heading"><p className="eyebrow">إدارة الكتالوج</p><h1 id="catalog-page-title">الكتالوج</h1><p className="lead">أدر الموارد المركزية كمسارات مستقلة: المجالات والتصنيفات، المنتجات، مراجعة المقترحات، ثم معاينة الاستيراد والالتزام الصريح.</p></div><CatalogVerticalRegistry /><CatalogCategoryRegistry /><CentralCatalog /><CatalogGovernancePanel /></section>;
}
