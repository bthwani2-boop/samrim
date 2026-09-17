"use client";

import { CentralCatalog } from "../../../src/features/central-catalog/central-catalog";
import { CatalogCategoryRegistry } from "../../../src/features/central-catalog/catalog-category-registry";
import { CatalogVerticalRegistry } from "../../../src/features/central-catalog/catalog-vertical-registry";
import { useSession } from "../../../src/session/session-provider";

export default function CentralCatalogPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>المنتجات المركزية للمشغلين فقط</h1><p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p></div></section>;
  return <section className="workspace-page" aria-labelledby="catalog-page-title"><div className="workspace-page-heading"><p className="eyebrow">إدارة الكتالوج</p><h1 id="catalog-page-title">كتالوج التجارة</h1><p className="lead">ابدأ بتسجيل المجالات التجارية وتصنيفات المنتجات، ثم أدر الهوية الكانونية للمنتج ونسخه، واترك السعر والتوافر والنشر لعرض المتجر.</p></div><CatalogVerticalRegistry /><CatalogCategoryRegistry /><CentralCatalog /></section>;
}
