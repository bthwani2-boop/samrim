"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import { CommandSectionTabs } from "../shared/command-surface";
import { CatalogActivityWorkspace } from "./catalog-activity-workspace";
import { CatalogCommandOverview } from "./catalog-command-overview";
import { CatalogProposalReview } from "./catalog-proposal-review";
import { CatalogTaxonomyWorkspace } from "./catalog-taxonomy-workspace";
import { CentralCatalog } from "./central-catalog";

type CatalogView = "command" | "products" | "categories" | "proposals" | "activity";
const views: ReadonlyArray<{ id: CatalogView; label: string }> = [
  { id:"command",label:"القيادة" },
  { id:"categories",label:"المجالات والفئات" },
  { id:"products",label:"المنتجات" },
  { id:"proposals",label:"المراجعة" },
];

function viewFromLocation(): CatalogView {
  const params = new URL(window.location.href).searchParams;
  const value = params.get("catalogView");
  if (value === "products" || value === "categories" || value === "proposals" || value === "activity") return value;
  if (params.has("productId") || params.has("mode") || params.has("q") || params.has("productCursor") || params.has("view")) return "products";
  return "command";
}

export function CatalogCenterWorkspace() {
  const { state } = useSession();
  // DSH requires both catalog and partners grants to read cross-store history.
  const activityAllowed = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") && state.identity.permissions?.includes("partners");
  const visibleViews: typeof views = activityAllowed ? [...views, { id: "activity", label: "سجل النشاط" }] : views;
  const [view,setView] = useState<CatalogView>("command");
  const [visited,setVisited] = useState<ReadonlySet<CatalogView>>(()=>new Set(["command"]));
  useEffect(()=>{
    const restore=()=>{
      const requested=viewFromLocation();
      const next=requested==="activity"&&!activityAllowed ? "command" : requested;
      if (requested!==next) {
        const url=new URL(window.location.href);
        url.searchParams.delete("catalogView");
        window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
      }
      setView(next);
      setVisited(current=>new Set([...current,next]));
    };
    restore();
    window.addEventListener("popstate",restore);
    return ()=>window.removeEventListener("popstate",restore);
  },[activityAllowed]);

  function switchTo(next: CatalogView) {
    if(next==="activity"&&!activityAllowed)return;
    if(next===view)return;
    const url=new URL(window.location.href);
    if(next==="command") {
      url.searchParams.delete("catalogView");
      url.searchParams.delete("productId");
      url.searchParams.delete("mode");
      url.searchParams.delete("view");
    } else url.searchParams.set("catalogView",next);
    window.history.pushState({...window.history.state,catalogView:next},"",url.pathname+url.search+url.hash);
    setVisited(current=>new Set([...current,next]));
    setView(next);
  }

  function openProduct(productId: string) {
    const url=new URL(window.location.href);
    url.searchParams.set("catalogView","products");
    url.searchParams.set("mode","edit");
    url.searchParams.set("productId",productId);
    url.searchParams.delete("productCursor");
    window.history.pushState({...window.history.state,catalogView:"products"},"",url.pathname+url.search+url.hash);
    setVisited(current=>new Set([...current,"products"]));
    setView("products");
  }

  return <div className="catalog-center work-stack bt-command-frame" data-testid="catalog-center">
    <CommandSectionTabs label="أقسام الكتالوج" active={view} tabs={visibleViews} onSelect={switchTo}/>
    <section className="catalog-command-content" hidden={view!=="command"} aria-label="قيادة الكتالوج">
      {view==="command" ? <CatalogCommandOverview onOpenProduct={openProduct} onViewProducts={()=>switchTo("products")}/> : null}
      <nav className="catalog-command-links" aria-label="عمليات الكتالوج">
        <Link className="button button-secondary" href="/catalog/import">استيراد المنتجات</Link>
        <Link className="button button-quiet" href="/catalog/trash">المحذوفات</Link>
      </nav>
    </section>
    {visited.has("products") ? <section className="catalog-command-content" hidden={view!=="products"} aria-label="المنتجات"><CentralCatalog/></section>:null}
    {visited.has("categories") ? <section className="catalog-command-content" hidden={view!=="categories"} aria-label="المجالات والفئات"><CatalogTaxonomyWorkspace/></section>:null}
    {visited.has("proposals") ? <section className="catalog-command-content" hidden={view!=="proposals"} aria-label="المراجعة"><CatalogProposalReview/></section>:null}
    {activityAllowed && visited.has("activity") ? <section className="catalog-command-content" hidden={view!=="activity"} aria-label="سجل النشاط"><CatalogActivityWorkspace/></section>:null}
  </div>;
}
