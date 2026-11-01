"use client";

import { scopedCatalogInventorySummary, type CatalogInventorySummary } from "@bthwani/dsh";
import { useEffect, useState } from "react";

export function StoreInventorySummary({ storeId, onOpenCatalog }: Readonly<{storeId:string;onOpenCatalog:()=>void}>) {
 const [summary,setSummary]=useState<CatalogInventorySummary|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  void refresh;
  let active=true;
  const controller=new AbortController();
  setLoading(true);setSummary(null);setError("");
  void(async()=>{
   const response=await fetch("/api/stores/"+encodeURIComponent(storeId)+"/inventory-summary",{cache:"no-store",signal:controller.signal});
   if(!response.ok)throw new Error("DSH_INVENTORY_UNAVAILABLE");
   const input=await response.json() as unknown;
   const valid=scopedCatalogInventorySummary(input,storeId);
   if(!valid)throw new Error("DSH_INVENTORY_SCOPE_INVALID");
   if(active){setSummary(valid);setLoading(false);}
  })().catch(()=>{if(active){setError("تعذر قراءة إجمالي المخزون؛ أعد المحاولة.");setLoading(false);}});
  return ()=>{active=false;controller.abort();};
 },[storeId,refresh]);
 const items=summary?[
  {label:"كل العروض",value:summary.totalOffers},
  {label:"المنشورة",value:summary.publishedOffers},
  {label:"المتاحة",value:summary.availableOffers},
  {label:"غير المتاحة",value:summary.unavailableOffers},
  {label:"نافدة المخزون",value:summary.stockoutOffers},
 ]:[];
 return <section className="store-profile-card" aria-label="إجماليات مخزون المتجر">
  <header className="store-profile-card-header"><h3>متابعة مخزون المتجر</h3></header>
  {loading?<p role="status">جارٍ قراءة إجماليات المخزون من DSH…</p>:null}
  {error?<button type="button" onClick={()=>setRefresh(n=>n+1)} aria-label="إعادة قراءة مخزون المتجر">{error}</button>:null}
  {summary&&!loading&&!error?<><div className="store-profile-kpis">{items.map(item=><div className="store-profile-kpi" key={item.label}><div><span>{item.label}</span><strong>{item.value.toLocaleString("ar-YE")}</strong></div></div>)}</div>
   <p>إجماليات جميع العروض من DSH، لا الصفحة الحالية. إتاحة المنتج لا تعني أن المتجر مفتوح للطلبات.</p>
   <button className="button" type="button" onClick={onOpenCatalog}>فتح المنتجات والعروض</button>
  </>:null}
 </section>;
}
