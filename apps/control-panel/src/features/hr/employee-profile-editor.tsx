"use client";

import { type FormEvent, useRef, useState } from "react";
import type { HREmployee, HRUpdateEmployeeInput } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { EmployeeManagerSelect } from "./employee-manager-select";

export function EmployeeProfileEditor({employee, colleagues, onSaved}:{
 employee:HREmployee;
 colleagues:readonly HREmployee[];
 onSaved:(next:HREmployee)=>void;
}) {
 const [editing,setEditing]=useState(false);
 const [form,setForm]=useState<HRUpdateEmployeeInput>({
  fullNameAr:employee.fullNameAr,phoneE164:employee.phoneE164??"",
  department:employee.department,jobTitle:employee.jobTitle,
  managerEmployeeId:employee.managerEmployeeId??"",startDate:employee.startDate,
  workLocation:employee.workLocation,expectedVersion:employee.version,
 });
 const [pending,setPending]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const mutation=useRef<{signature:string;key:string}|null>(null);
 function change(key:Exclude<keyof HRUpdateEmployeeInput,"expectedVersion">,value:string){
  setForm((v)=>({...v,[key]:value}));mutation.current=null;setError("");
 }
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(pending)return;
  const input={...form,
   fullNameAr:form.fullNameAr.trim(),phoneE164:form.phoneE164.trim(),
   department:form.department.trim(),jobTitle:form.jobTitle.trim(),
   workLocation:form.workLocation.trim(),
  };
  const signature=JSON.stringify(input);
  if(mutation.current?.signature!==signature)mutation.current={signature,key:crypto.randomUUID()};
  setPending(true);setError("");setNotice("");
  try{
   const response=await identityFetch(`/api/hr/employees/${encodeURIComponent(employee.id)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json","Idempotency-Key":mutation.current.key},body:JSON.stringify(input),
   });
   if(!response.ok){
    if(response.status===409)throw new Error("تعارض التعديل مع إصدار الملف أو رقم هاتف مستخدم، أو توجد رحلة وصول قيد المراجعة تمنع تعديل الهوية. أعد تحميل الملف وراجع طلب الوصول.");
    throw new Error("تعذر حفظ التعديل. أعد المحاولة بنفس البيانات.");
   }
   const result=await response.json() as {employee:HREmployee};
   mutation.current=null;
   setForm({...input,expectedVersion:result.employee.version});
   setEditing(false);setNotice("تم حفظ التعديل وتوثيقه.");
   onSaved(result.employee);
  }catch(e){setError(e instanceof Error?e.message:"تعذر حفظ التعديل")}
  finally{setPending(false)}
 }
 return <section className="form-section" style={{maxInlineSize:720}}>
  <div className="access-section-heading">
   <h3>البيانات الوظيفية</h3>
   <button type="button" className="button button-secondary" disabled={pending} onClick={()=>setEditing((v)=>!v)}>{editing?"إغلاق التعديل":"تعديل البيانات"}</button>
  </div>
  {notice?<p role="status">{notice}</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {editing?<form onSubmit={(event)=>void save(event)} className="access-create-form">
   <label className="field-label">الاسم الكامل<input required minLength={2} maxLength={120} value={form.fullNameAr} onChange={(e)=>change("fullNameAr",e.target.value)}/></label>
   <label className="field-label">رقم الهاتف (اختياري)<input type="tel" dir="ltr" placeholder="+967777000100" value={form.phoneE164} onChange={(e)=>change("phoneE164",e.target.value)}/></label>
   <label className="field-label">القسم<input required maxLength={80} value={form.department} onChange={(e)=>change("department",e.target.value)}/></label>
   <label className="field-label">المسمى الوظيفي<input required maxLength={80} value={form.jobTitle} onChange={(e)=>change("jobTitle",e.target.value)}/></label>
   <label className="field-label">تاريخ بدء العمل<input required type="date" value={form.startDate} onChange={(e)=>change("startDate",e.target.value)}/></label>
   <label className="field-label">موقع العمل<input required maxLength={100} value={form.workLocation} onChange={(e)=>change("workLocation",e.target.value)}/></label>
   <EmployeeManagerSelect value={form.managerEmployeeId} initial={colleagues} excludeId={employee.id}
     onChange={(id)=>change("managerEmployeeId",id)} disabled={pending}/>
   <div className="form-actions"><button type="submit" className="button button-primary" disabled={pending}>{pending?"جارٍ الحفظ…":"حفظ التغييرات"}</button></div>
  </form>:null}
 </section>;
}
