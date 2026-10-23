"use client";

import { useEffect,useState } from "react";

type CaseEvent=Readonly<{
 id:number;caseId:number;action:"OPEN"|"CLAIM"|"ACTION_REQUIRED"|"NEXT_ACTION"|"RESOLVE";
 actorId:string;detail:string;createdAt:string;
}>;
type Page=Readonly<{items:ReadonlyArray<CaseEvent>;nextCursor:string}>;
const labels:Readonly<Record<CaseEvent["action"],string>>={
 OPEN:"فتح الحالة",CLAIM:"استلام المسؤولية",
 ACTION_REQUIRED:"تحتاج إجراءً",NEXT_ACTION:"تحديث الإجراء التالي",RESOLVE:"توثيق الحل",
};
function recordedAt(value:string){
 const time=new Date(value);
 return Number.isFinite(time.getTime())?time.toLocaleString("ar-YE"):"وقت غير موثوق";
}

export function OperatorCaseAudit({orderId,caseId,openedAt,updatedAt}:Readonly<{
 orderId:string;caseId:number;openedAt:string;updatedAt:string;
}>){
 const [visible,setVisible]=useState(false);
 const [items,setItems]=useState<ReadonlyArray<CaseEvent>>([]);
 const [cursor,setCursor]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [reloadToken,setReloadToken]=useState(0);
 useEffect(()=>{
  if(!visible)return;
  const controller=new AbortController();
  let live=true;
  async function load(){
   setBusy(true);setError("");
   try{
    const response=await fetch(
      `/api/operations/${encodeURIComponent(orderId)}/cases/${caseId}/events?limit=15`,
      {cache:"no-store",signal:controller.signal});
    if(!response.ok)throw new Error("AUDIT_READ_FAILED");
    const body=await response.json() as Page;
    if(!Array.isArray(body.items)||typeof body.nextCursor!=="string"||
      !body.items.every(item=>item&&item.caseId===caseId&&Number.isSafeInteger(item.id)&&item.id>0))
      throw new Error("INVALID_AUDIT_READBACK");
    if(live){setItems(body.items);setCursor(body.nextCursor);}
   }catch{if(live){setError("تعذرت قراءة سجل الحالة؛ لا يمكن تأكيد آخر إجراء.");setItems([]);setCursor("");}}
   finally{if(live)setBusy(false);}
  }
  void load();
  return ()=>{live=false;controller.abort();};
 },[visible,orderId,caseId,reloadToken]);
 async function more(){
  if(busy||!cursor)return;
  setBusy(true);setError("");
  try{
   const params=new URLSearchParams({limit:"15",cursor});
   const response=await fetch(
     `/api/operations/${encodeURIComponent(orderId)}/cases/${caseId}/events?${params.toString()}`,
     {cache:"no-store",signal:AbortSignal.timeout(12_000)});
   if(!response.ok)throw new Error("AUDIT_PAGE_FAILED");
   const page=await response.json() as Page;
   if(!Array.isArray(page.items)||typeof page.nextCursor!=="string"||
      !page.items.every(item=>item&&item.caseId===caseId&&Number.isSafeInteger(item.id)))
     throw new Error("INVALID_AUDIT_PAGE");
   setItems(previous=>{
    const existing=new Set(previous.map(item=>item.id));
    return [...previous,...page.items.filter(item=>!existing.has(item.id))];
   });
   setCursor(page.nextCursor);
  }catch{setError("تعذر تحميل بقية أحداث الحالة.");}
  finally{setBusy(false);}
 }
 return <div className="order-case-audit">
  <p className="muted">فُتحت: {recordedAt(openedAt)} · آخر تغيير: {recordedAt(updatedAt)}</p>
  <button className="button button-secondary" type="button" disabled={busy}
    onClick={()=>{setVisible(v=>!v);setError("");}}>
   {visible?"إخفاء السجل":"سجل الإجراءات"}
  </button>
  {visible?<div>
   {busy&&items.length===0?<p role="status" className="muted">جارٍ قراءة السجل…</p>:null}
   {error?<p role="alert">{error} <button type="button" className="button button-secondary" onClick={()=>setReloadToken(x=>x+1)}>إعادة القراءة</button></p>:null}
   {!busy&&!error&&items.length===0?<p className="muted">لا توجد أحداث يمكن عرضها.</p>:null}
   {items.map(event=><div key={event.id} className="order-case-event">
    <strong>{labels[event.action]??"إجراء"}{event.actorId==="dsh:operations-detector"?" · تلقائي":""}</strong>
    <p className="muted">{recordedAt(event.createdAt)} · {event.actorId==="dsh:operations-detector"?"النظام":event.actorId}</p>
    {event.detail?<p>{event.detail}</p>:null}
   </div>)}
   {cursor?<button type="button" className="button button-secondary" disabled={busy}
      onClick={()=>void more()}>أحداث أقدم</button>:null}
  </div>:null}
 </div>;
}
