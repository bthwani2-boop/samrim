"use client";
import { TextArea } from "@bthwani/design-system/web";
import { useRef, useState } from "react";
import type { HREmployee } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";

export function EmployeeEmploymentStatus({employee,onSaved}: Readonly<{employee:HREmployee;onSaved:(next:HREmployee)=>void}>) {
 const {state}=useSession();
 const [reason,setReason]=useState("");
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const key=useRef<string|null>(null);
 const root=state.kind==="authenticated"&&state.identity.canManageOperatorPermissions;
 if(employee.operatorActorId&&!root)return null;
 const target=employee.status==="active"?"inactive":"active";
 async function apply(){
  if(saving||reason.trim().length<8)return;
  setSaving(true);setError("");setNotice("");
  if(!key.current)key.current=crypto.randomUUID();
  try {
   const response=await identityFetch(`/api/hr/employees/${encodeURIComponent(employee.id)}/employment-status`,{
     method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key.current},
     body:JSON.stringify({status:target,reason:reason.trim(),expectedVersion:employee.version}),
   });
   const data=await response.json() as {employee?:HREmployee;error?:{message?:string}};
   if(!response.ok||!data.employee)throw new Error(data.error?.message||"تعذر تغيير الحالة الوظيفية. أعد المحاولة دون تغيير السبب.");
   key.current=null;
   onSaved(data.employee);
   setReason("");
   setNotice(target==="inactive"?"تم إيقاف الحالة الوظيفية، مع إبطال وصول التشغيل إن وجد.":"أصبحت الحالة الوظيفية نشطة. صلاحية التشغيل لا تُمنح تلقائيًا.");
  }catch(cause){setError(cause instanceof Error?cause.message:"تعذر تحديث الحالة الوظيفية");}
  finally{setSaving(false)}
 }
 return <section className="form-section form-section--w480" aria-label="الحالة الوظيفية">
  <h3>الحالة الوظيفية</h3>
  <p>الحالة الحالية: <strong>{employee.status==="active"?"على رأس العمل":"غير نشط"}</strong>.</p>
  <p className="muted">الحالة الوظيفية مستقلة عن صلاحية تشغيل المنصة. عند إيقاف موظف لديه وصول تشغيل، تُسحب صلاحية تشغيله وجلساته أولًا.</p>
  <label className="field-label" htmlFor="employee-employment-status-reason">سبب تغيير الحالة الوظيفية
   <TextArea className="resize-none" id="employee-employment-status-reason" rows={2} maxLength={500} disabled={saving} value={reason} onChange={e=>{key.current=null;setReason(e.target.value);setError("");}}/>
  </label>
  <button type="button" className="button button-secondary" disabled={saving||reason.trim().length<8} onClick={()=>void apply()}>
   {saving?"جارٍ تنفيذ القرار…":target==="inactive"?"إيقاف الحالة الوظيفية":"إعادة تنشيط الحالة الوظيفية"}
  </button>
  {notice?<p role="status">{notice}</p>:null}
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
