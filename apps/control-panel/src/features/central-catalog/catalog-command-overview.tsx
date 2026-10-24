"use client";

import type { CatalogProductRegistryResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";
import { CommandBarPanel, CommandDecisionList, CommandMetricStrip } from "../shared/command-surface";

export function CatalogCommandOverview({ onOpenProduct, onViewProducts }: Readonly<{
  onOpenProduct: (id:string)=>void; onViewProducts:()=>void;
}>) {
  const [data,setData] = useState<CatalogProductRegistryResponse|null>(null);
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState("");
  const [revision,setRevision] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setBusy(true);setError("");
    void fetch(`/api/catalog/product-registry?active=all&sort=name_asc&retry=${revision}`,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error("تعذرت قراءة سجل المنتجات من DSH.");
        const value=await response.json() as CatalogProductRegistryResponse;
        if(!value||!Array.isArray(value.products)||!Number.isSafeInteger(value.totalCount)||value.totalCount<0||
          !value.measuredAt||!value.products.every(row=>typeof row.id==="string"&&typeof row.active==="boolean"))
          throw Error("استجابة سجل المنتجات غير صالحة.");
        if(!controller.signal.aborted)setData(value);
      })
      .catch(cause=>{if(!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:"سجل المنتجات غير متاح");}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[revision]);
  const entries=data?.products??[];
  const active=entries.filter(row=>row.active).length;
  const withImages=entries.filter(row=>Boolean(row.primaryImageUri)).length;
  const classified=entries.filter(row=>row.categoryIds.length>0).length;
  const withVariants=entries.filter(row=>row.variantCount>0).length;
  const linked=entries.filter(row=>row.storeCount>0).length;
  const missing=entries.filter(row=>!row.primaryImageUri||row.categoryIds.length===0||row.variantCount===0);
  const metrics=[
    {id:"products",label:"إجمالي المنتجات",value:data?.totalCount??null,description:"إجمالي معتمد من السجل",tone:"normal" as const},
    {id:"active",label:"النشطة في الصفحة",value:data?active:null,description:"من أول صفحة محمّلة",tone:"success" as const},
    {id:"images",label:"صور ناقصة",value:data?entries.length-withImages:null,description:"ضمن السجلات المحمّلة",tone:"warning" as const},
    {id:"categories",label:"دون تصنيف",value:data?entries.length-classified:null,description:"ضمن السجلات المحمّلة",tone:"danger" as const},
    {id:"variants",label:"دون متغيرات",value:data?entries.length-withVariants:null,description:"ضمن السجلات المحمّلة",tone:"warning" as const},
  ];
  return <div className="bt-command-coverage" data-testid="catalog-command" aria-busy={busy}>
    <CommandMetricStrip metrics={metrics}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="جاهزية بيانات المنتجات" subtitle="نسب من الصفحة المحمّلة، وليست كل الكتالوج"
        measures={data?[{id:"images",label:"بصور",value:withImages,tone:"success"},
          {id:"classified",label:"مصنفة",value:classified,tone:"normal"},
          {id:"variants",label:"بمتغيرات",value:withVariants,tone:"normal"},
          {id:"linked",label:"مرتبطة بمتاجر",value:linked,tone:"warning"}]:[]} total={entries.length}/>
      <CommandBarPanel title="حالة النشر" subtitle="المنتجات التي استُرجعت في الصفحة الأولى"
        measures={data?[{id:"active",label:"نشطة",value:active,tone:"success"},
          {id:"inactive",label:"غير نشطة",value:entries.length-active,tone:"warning"}]:[]} total={entries.length}/>
    </div>
    <CommandDecisionList title="منتجات تحتاج استكمال البيانات" items={missing.slice(0,5).map(row=>({
      id:row.id,title:row.canonicalName,
      description:!row.primaryImageUri?"صورة أساسية غير متاحة":!row.categoryIds.length?"دون تصنيف":"دون متغيرات",
      tone:"warning" as const,action:()=>onOpenProduct(row.id),
    }))} footer={<button type="button" onClick={onViewProducts}>فتح سجل المنتجات الكامل ←</button>}/>
    {busy?<p role="status" className="bt-command-footnote">جارٍ تحميل بيانات الكتالوج...</p>:
      error?<div role="alert" className="access-card"><p>{error}</p>
        <button type="button" className="button button-secondary" onClick={()=>setRevision(n=>n+1)}>إعادة المحاولة</button></div>:
      <p className="bt-command-footnote">إجمالي المنتجات من السجل: {data?.totalCount.toLocaleString("ar-YE")}. أما تحليلات الصور والتصنيف والمتغيرات فهي للصفحة المحمّلة فقط ({entries.length.toLocaleString("ar-YE")} سجلًا). آخر قياس: {data?.measuredAt?new Date(data.measuredAt).toLocaleString("ar-YE"):"—"}.</p>}
  </div>;
}
