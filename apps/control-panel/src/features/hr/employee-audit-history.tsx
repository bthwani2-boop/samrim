"use client";
import { useState } from "react";
import type { HREmployee,HREmployeeEvent,HREmployeeEventsPage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";

const eventLabel:Readonly<Record<HREmployeeEvent["eventType"],string>>={
 created:"إنشاء ملف الموظف",updated:"تحديث بيانات الموظف",status_changed:"تغيير الحالة الوظيفية",
};
export function EmployeeAuditHistory({employee}:Readonly<{employee:HREmployee}>){
 const [open,setOpen]=useState(false);
 const [items,setItems]=useState<readonly HREmployeeEvent[]>([]);
 const [nextCursor,setNextCursor]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function load(cursor=""){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const params=new URLSearchParams({cursor});
   const response=await identityFetch(`/api/hr/employees/${encodeURIComponent(employee.id)}/events?${params}`);
   const result=await response.json() as HREmployeeEventsPage&{error?:{message?:string}};
   if(!response.ok)throw new Error(result.error?.message||"تعذر قراءة سجل الموظف");
   setItems((previous)=>cursor?[...previous,...result.items]:result.items);
   setNextCursor(result.nextCursor??"");
  }catch(cause){setError(cause instanceof Error?cause.message:"تعذر تحميل السجل");}
  finally{setBusy(false)}
 }
 return <section className="form-section" aria-label="سجل تغييرات الموظف" style={{maxInlineSize:720}}>
  <button type="button" className="button button-secondary" disabled={busy} onClick={()=>{
   if(open){setOpen(false);return}
   setOpen(true);void load();
  }}>{open?"إغلاق سجل التغييرات":"عرض سجل التغييرات"}</button>
  {open?<div>
   <p className="muted">سجل القرارات المحفوظ للموظف نفسه، مع صاحب القرار والسبب والتاريخ.</p>
   <ol>
    {items.map((event)=><li key={`${event.createdAt}-${event.eventType}-${event.actingActorId}`}>
     <strong>{eventLabel[event.eventType]}</strong>
     <span> — {new Date(event.createdAt).toLocaleString("ar-YE")}</span>
     <p>بواسطة <bdi dir="ltr">{event.actingActorId}</bdi></p>
     {event.reason?<p>السبب: {event.reason}</p>:null}
    </li>)}
   </ol>
   {!busy&&items.length===0?<p>لا توجد أحداث مسجلة.</p>:null}
   {nextCursor?<button type="button" className="button button-secondary" disabled={busy} onClick={()=>void load(nextCursor)}>عرض أحداث أقدم</button>:null}
   {busy?<p role="status">جارٍ تحميل الأحداث…</p>:null}
   {error?<p role="alert">{error}</p>:null}
  </div>:null}
 </section>;
}
