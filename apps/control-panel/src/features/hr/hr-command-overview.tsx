"use client";

import type { HREmployeePage } from "../../server/dsh/dsh-bff";
import { useEffect, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { CommandBarPanel, CommandDecisionList, CommandMetricStrip } from "../shared/command-surface";

export function HRCommandOverview({ onEmployee, onRegistry }: Readonly<{onEmployee:(id:string)=>void;onRegistry:()=>void}>) {
  const [page,setPage]=useState<HREmployeePage|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError("");
    void identityFetch(`/api/hr/employees?limit=50&retry=${revision}`,{signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error("تعذرت قراءة ملفات الموظفين.");
        const data=await response.json() as HREmployeePage;
        if(!data||!Array.isArray(data.items)||!data.items.every(item=>typeof item.id==="string"&&typeof item.fullNameAr==="string"&&(item.status==="active"||item.status==="inactive")))
          throw Error("استجابة الموظفين غير صالحة.");
        if(!controller.signal.aborted)setPage(data);
      }).catch(e=>{if(!controller.signal.aborted){setPage(null);setError(e instanceof Error?e.message:"الموارد البشرية غير متاحة");}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[revision]);
  const items=page?.items??[];
  const active=items.filter(row=>row.status==="active").length;
  const departments=new Map<string,number>();
  for(const employee of items) {
    const name=employee.department.trim()||"غير محدد";
    departments.set(name,(departments.get(name)??0)+1);
  }
  const unlinked=items.filter(row=>row.status==="active"&&!row.operatorActorId);
  return <div className="bt-command-coverage" data-testid="hr-command" aria-busy={loading}>
    <CommandMetricStrip metrics={[
      {id:"employees",label:"ملفات موظفين معروضة",value:page?items.length:null,description:"من الصفحة المحمّلة"},
      {id:"active",label:"موظفون نشطون",value:page?active:null,description:"من السجلات المحمّلة",tone:"success"},
      {id:"inactive",label:"غير نشطين",value:page?items.length-active:null,description:"من السجلات المحمّلة",tone:"warning"},
      {id:"linked",label:"مرتبطون بحسابات مشغلين",value:page?items.filter(row=>Boolean(row.operatorActorId)).length:null,description:"ملفات مرتبطة بالهوية"},
    ]}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="توزيع الموظفين حسب الإدارة" subtitle="التوزيع ضمن الصفحة المحمّلة" total={items.length}
        measures={page?Array.from(departments,([id,value])=>({id,label:id,value})).sort((a,b)=>b.value-a.value).slice(0,7):[]}/>
      <CommandBarPanel title="حالة العمل" subtitle="حالات الملفات المعروضة" total={items.length}
        measures={page?[{id:"active",label:"نشط",value:active,tone:"success"},
          {id:"inactive",label:"غير نشط",value:items.length-active,tone:"warning"}]:[]}/>
    </div>
    <CommandDecisionList title="ملفات تحتاج مراجعة الربط" items={unlinked.slice(0,5).map(row=>({
      id:row.id,title:row.fullNameAr,description:(row.department||"إدارة غير محددة")+" · سجل نشط بلا ربط مشغّل",
      tone:"warning" as const,action:()=>onEmployee(row.id),
    }))} footer={<button type="button" onClick={onRegistry}>فتح سجل الموظفين ←</button>}/>
    {loading?<p role="status" className="bt-command-footnote">جارٍ قراءة ملفات الموظفين...</p>:
      error?<div role="alert" className="access-card"><p>{error}</p><button className="button button-secondary" type="button" onClick={()=>setRevision(n=>n+1)}>إعادة المحاولة</button></div>:
      <p className="bt-command-footnote">توزيع الإدارات والحالات يخص {items.length.toLocaleString("ar-YE")} ملفًا مسترجعًا{page?.nextCursor?"، وتوجد ملفات إضافية في صفحات لاحقة":""}. لا تُستنتج منه إجماليات الموارد البشرية أو حضور العاملين.</p>}
  </div>;
}
