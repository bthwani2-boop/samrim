"use client";

import { useEffect, useState } from "react";
import { CatalogProposalReview } from "./catalog-proposal-review";
import { CatalogTaxonomyWorkspace } from "./catalog-taxonomy-workspace";
import { CentralCatalog } from "./central-catalog";

type CatalogView = "products" | "categories" | "proposals";
const views: ReadonlyArray<{ id: CatalogView; label: string }> = [
  { id: "products", label: "المنتجات" },
  { id: "categories", label: "الفئات" },
  { id: "proposals", label: "مقترحات الشركاء" },
];
function viewFromLocation(): CatalogView {
  const value = new URL(window.location.href).searchParams.get("catalogView");
  return value === "categories" || value === "proposals" ? value : "products";
}

export function CatalogCenterWorkspace() {
  const [view, setView] = useState<CatalogView>("products");
  const [visited, setVisited] = useState<ReadonlySet<CatalogView>>(() => new Set(["products"]));

  useEffect(() => {
    const restore = () => {
      const next = viewFromLocation();
      setView(next);
      setVisited((old) => new Set([...old, next]));
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function switchTo(next: CatalogView) {
    if (next === view) return;
    const url = new URL(window.location.href);
    if (next === "products") url.searchParams.delete("catalogView");
    else url.searchParams.set("catalogView", next);
    window.history.pushState({ ...window.history.state, catalogView: next }, "", `${url.pathname}${url.search}${url.hash}`);
    setVisited((old) => new Set([...old, next]));
    setView(next);
  }

  return <div className="catalog-center work-stack" data-testid="catalog-center">
    <div className="catalog-command-bar">
      <fieldset className="catalog-command-views"><legend className="visually-hidden">إدارة الكتالوج</legend>
        {views.map((entry) => <button key={entry.id} className="catalog-command-view" type="button" aria-pressed={view === entry.id} onClick={() => switchTo(entry.id)}>{entry.label}</button>)}
      </fieldset>
      <nav className="catalog-command-links" aria-label="عمليات الكتالوج المتخصصة">
        <a className="button button-secondary" href="/catalog/import">استيراد</a>
        <a className="button button-quiet" href="/catalog/trash">سلة المحذوفات</a>
      </nav>
    </div>
    <section className="catalog-command-content" aria-label="المنتجات" hidden={view !== "products"}><CentralCatalog /></section>
    {visited.has("categories") ? <section className="catalog-command-content" aria-label="الفئات" hidden={view !== "categories"}><CatalogTaxonomyWorkspace /></section> : null}
    {visited.has("proposals") ? <section className="catalog-command-content" aria-label="مقترحات الشركاء" hidden={view !== "proposals"}><CatalogProposalReview /></section> : null}
  </div>;
}
