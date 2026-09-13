"use client";

import { CentralCatalog } from "../../../src/features/central-catalog/central-catalog";
import { useSession } from "../../../src/session/session-provider";

export default function CentralCatalogPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>المنتجات المركزية للمشغلين فقط</h1><p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p></div></section>;
  return <section className="workspace-page" aria-labelledby="catalog-page-title"><div className="workspace-page-heading"><p className="eyebrow">DSH · CENTRAL PRODUCT / ASSORTMENT</p><h1 id="catalog-page-title">المنتجات المركزية</h1><p className="lead">أدر الهوية المركزية للمنتج، ثم اترك السعر والتوافر والنشر لكل Store Assortment يملكه الشريك.</p></div><CentralCatalog /></section>;
}
