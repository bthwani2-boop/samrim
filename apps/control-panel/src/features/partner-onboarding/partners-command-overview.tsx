"use client";

import { useEffect, useState } from "react";
import { CommandBarPanel, CommandDecisionList, CommandMetricStrip } from "../shared/command-surface";

type Row = {kind:"joining";case:{id:string;businessName:string;state:string;firstStoreName?:string}}|
  {kind:"access";grant:{id:string;storeName:string;state?:string}}|
  {kind:"store";store:{id:string;name:string;publicationState?:string}}|
  {kind:"partner";actor:{actorId:string}};
type Payload = {rows:Row[];nextCursor?:string};
export function PartnersCommandOverview({onTab,onCase}:Readonly<{onTab:(tab:"directory"|"joining"|"access")=>void;onCase:(caseId:string)=>void;}>) {
  const [data,setData] = useState<Payload|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError("");
    void fetch(`/api/partners/workbench?kind=all&sort=newest&retry=${attempt}`,{cache:"no-store",signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error("تعذرت قراءة سجلات الشركاء من الخدمة.");
        const value=await response.json() as Payload;
        if(!value||!Array.isArray(value.rows)||typeof value.nextCursor!=="string"||
          !value.rows.every(item=>["joining","access","store","partner"].includes(item.kind)))
            throw Error("بيانات الشركاء غير صالحة.");
        if(!controller.signal.aborted)setData(value);
      }).catch(e=>{if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:"مصدر الشركاء غير متاح");}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return ()=>controller.abort();
  },[attempt]);
  const rows=data?.rows??[];
  const count=(kind:Row["kind"])=>rows.filter(row=>row.kind===kind).length;
  const joining=rows.filter((r):r is Extract<Row,{kind:"joining"}>=>r.kind==="joining");
  const awaiting=joining.filter(r=>["submitted","admission_requested","needs_correction"].includes(r.case.state));
  const kinds=[
    {id:"stores",label:"المتاجر",value:count("store"),tone:"success" as const},
    {id:"partners",label:"حسابات الشركاء",value:count("partner")},
    {id:"joining",label:"طلبات الانضمام",value:count("joining"),tone:"warning" as const},
    {id:"access",label:"تفويض الوصول",value:count("access")},
  ];
  const states=new Map<string,number>();
  for(const item of joining)states.set(item.case.state,(states.get(item.case.state)??0)+1);
  const labels:Record<string,string>={submitted:"قيد المراجعة",admission_requested:"تحتاج قبولًا",needs_correction:"تحتاج تصحيحًا",draft:"مسودة",approved:"معتمدة"};
  return <div className="bt-command-coverage" data-testid="partners-command" aria-busy={loading}>
    <CommandMetricStrip metrics={[
      {id:"stores",label:"متاجر معروضة",value:data?count("store"):null,description:"من سجلات المصدر المحمّلة",tone:"success",action:()=>onTab("directory")},
      {id:"accounts",label:"حسابات شركاء",value:data?count("partner"):null,description:"ضمن المعاينة الحالية",tone:"normal",action:()=>onTab("directory")},
      {id:"requests",label:"طلبات انضمام",value:data?count("joining"):null,description:"طلبات المعاينة",tone:"warning",action:()=>onTab("joining")},
      {id:"attention",label:"انضمام يحتاج متابعة",value:data?awaiting.length:null,description:"ضمن الحالات المعروضة",tone:"danger",action:()=>onTab("joining")},
      {id:"access",label:"تفويضات وصول",value:data?count("access"):null,description:"ضمن السجلات المعروضة",tone:"normal",action:()=>onTab("access")},
    ]}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="أصحاب المصلحة" subtitle="توزيع العينة المحمّلة، وليس إجمالي الشركاء" measures={data?kinds:[]} total={rows.length}/>
      <CommandBarPanel title="مراحل طلبات الانضمام" subtitle="حالات الطلبات ضمن الصفحة المسترجعة"
        measures={data?Array.from(states,([id,value])=>({id,label:labels[id]??id,value,tone:id==="approved"?"success" as const:"warning" as const})):[]}
        total={joining.length}/>
    </div>
    <CommandDecisionList title="انضمام يحتاج مراجعة" items={awaiting.slice(0,5).map(item=>({
      id:item.case.id,title:item.case.businessName,description:(labels[item.case.state]??item.case.state)+" · "+(item.case.firstStoreName??""),
      tone:"warning" as const,action:()=>onCase(item.case.id),
    }))} footer={<button type="button" onClick={()=>onTab("joining")}>عرض جميع طلبات الانضمام ←</button>}/>
    {loading?<p className="bt-command-footnote" role="status">جارٍ قراءة سجل الشركاء...</p>:
      error?<div className="access-card" role="alert"><p>{error}</p>
        <button type="button" className="button button-secondary" onClick={()=>setAttempt(n=>n+1)}>إعادة المحاولة</button></div>:
      <p className="bt-command-footnote">التوزيع والتصنيفات محسوبة من {rows.length.toLocaleString("ar-YE")} سجلًا فقط{data?.nextCursor?"، وتوجد صفحات لاحقة":""}. لا يمثل ذلك إجمالي شركاء بثواني.</p>}
  </div>;
}
