"use client";

import { TextArea } from "@bthwani/design-system/web";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { HRAccessRequest, HREmployee } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";

const workspaces = [
 ["operations","العمليات"],["partners","الشركاء"],["catalog","الكتالوج"],
 ["marketing","التسويق"],["finance","المالية"],["platform_policies","سياسات المنصة"],["hr","الموارد البشرية"],
] as const;

export function EmployeeAccessRequest({ employee }: { employee: HREmployee }) {
 const [reason,setReason]=useState("");
 const [requestedPermissions,setRequestedPermissions]=useState<string[]>([]);
 const [pending,setPending]=useState(false);
 const [sent,setSent]=useState<HRAccessRequest|null>(null);
 const [rejected,setRejected]=useState<HRAccessRequest|null>(null);
 const [checking,setChecking]=useState(true);
 const [error,setError]=useState("");
 const mutation=useRef<{signature:string;key:string}|null>(null);
 useEffect(()=>{
  let live=true;
  async function check(){
   try{
    const response=await identityFetch(`/api/hr/access-requests?employeeId=${encodeURIComponent(employee.id)}`);
    if(!response.ok)throw new Error("تعذر التحقق من طلبات الوصول السابقة.");
    const page=await response.json() as {items:HRAccessRequest[]};
    if(live){
     const latest=page.items[0]??null;
     setSent(latest?.state==="rejected"?null:latest);
     setRejected(latest?.state==="rejected"?latest:null);
    }
   }catch{if(live)setError("تعذر التحقق من طلب الوصول السابق. حاول فتح الملف مجددًا.")}
   finally{if(live)setChecking(false)}
  }
  void check();
  return ()=>{live=false};
 },[employee.id]);
 const toggle=(key:string,checked:boolean)=>{
  setRequestedPermissions((prev)=>checked?[...prev,key]:prev.filter((x)=>x!==key));
  mutation.current=null;
 };
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(pending||sent||checking)return;
  const body={employeeId:employee.id,reason:reason.trim(),requestedPermissions};
  if(body.reason.length<8||body.reason.length>500){setError("يجب توضيح سبب طلب الوصول.");return}
  const signature=JSON.stringify(body);
  if(mutation.current?.signature!==signature)mutation.current={signature,key:crypto.randomUUID()};
  setPending(true);setError("");
  try{
   const response=await identityFetch("/api/hr/access-requests",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":mutation.current.key},body:JSON.stringify(body),
   });
   if(!response.ok){
    if(response.status===409)mutation.current=null;
    throw new Error(response.status===409?"يوجد طلب وصول سابق لهذا الموظف.":"تعذر إرسال طلب الوصول. حاول مجددًا.");
   }
   const result=await response.json() as {request:HRAccessRequest};
   setSent(result.request);setRejected(null);mutation.current=null;
  }catch(e){setError(e instanceof Error?e.message:"تعذر إرسال الطلب")}
  finally{setPending(false)}
 }
 if(employee.operatorActorId) return <p>هذا الموظف مرتبط بالفعل بحساب مشغّل.</p>;
 if(!employee.phoneE164) return <p>يجب تسجيل رقم هاتف الموظف الموثوق قبل تقديم طلب الوصول.</p>;
 return <form onSubmit={(event)=>void submit(event)} className="form-section form-section--w620" noValidate>
  <h3>طلب منح وصول للوحة التحكم</h3>
  <p className="muted">هذا طلب للمشغّل الأساسي فقط؛ لا يتم منح أي صلاحيات عند الإرسال.</p>
  {rejected?<p role="status">رُفض الطلب السابق: {rejected.rejectionReason||"راجع المشغّل الأساسي"}. يمكنك تصحيح بيانات الموظف وإرسال طلب جديد.</p>:null}
  {checking?<p role="status">جارٍ التحقق من حالة الطلب…</p>:sent?<p role="status">{sent.state==="pending_review"?"طلب الوصول بانتظار المشغّل الأساسي.":sent.state==="identity_provisioning"?"جارٍ تحويل الطلب إلى Identity.":"أُحيل الطلب إلى Identity وما زالت الموافقة على الوصول والتفعيل منفصلتين."}</p>:error?<p role="alert">{error}</p>:<>
   <label className="field-label" htmlFor="employee-access-request-reason">سبب طلب الوصول
    <TextArea className="resize-none" id="employee-access-request-reason" required minLength={8} maxLength={500} value={reason} onChange={(e)=>{setReason(e.target.value);mutation.current=null}}/>
  </label>
  <fieldset><legend>الأقسام المقترحة (اختياري، ولا تُمنح تلقائيًا)</legend>
   {workspaces.map(([key,label])=><label key={key} className="checkbox-field">
    <input type="checkbox" checked={requestedPermissions.includes(key)} onChange={(e)=>toggle(key,e.target.checked)}/>{label}
   </label>)}
  </fieldset>
  {error?<p role="alert">{error}</p>:null}
  <div className="form-actions"><button className="button button-primary" disabled={pending} type="submit">{pending?"جارٍ الإرسال…":"إرسال للمشغّل الأساسي"}</button></div>
  </>}
 </form>;
}
