"use client";
import { useCallback, useEffect, useState } from "react";
import type { HRAccessRequest, HRAccessRequestPage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";

export function HROperatorAccessQueue() {
 const [items,setItems]=useState<readonly HRAccessRequest[]>([]);
 const [cursor,setCursor]=useState("");
 const [previous,setPrevious]=useState<string[]>([]);
 const [next,setNext]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const reload=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const response=await identityFetch(`/api/access/hr-requests?cursor=${encodeURIComponent(cursor)}`);
   if(!response.ok)throw new Error("تعذر تحميل طلبات وصول الموظفين.");
   const page=await response.json() as HRAccessRequestPage;
   setItems(page.items);setNext(page.nextCursor??"");
  }catch(e){setItems([]);setNext("");setError(e instanceof Error?e.message:"تعذر تحميل الطلبات")}
  finally{setLoading(false)}
 },[cursor]);
 useEffect(()=>{void reload()},[reload]);
 async function openProfile(id:string){
  if(busy)return;
  setBusy(id);setError("");setNotice("");
  try{
   const response=await identityFetch(`/api/access/hr-requests/${encodeURIComponent(id)}/profile`,{method:"POST"});
   if(!response.ok)throw new Error("لم يكتمل تحويل الطلب. أعد المحاولة بنفس الطلب؛ لا تنشئ ملف مشغّل يدويًا لنفس الشخص.");
   setNotice("أُنشئ ملف مراجعة Identity. أكمل الاعتماد ومنح الدور وإصدار الدعوة من قائمة المشغّلين.");
   await reload();
  }catch(e){setError(e instanceof Error?e.message:"تعذر تحويل الطلب")}finally{setBusy("")}
 }
 return <section className="access-workspace-section">
  <div className="access-section-heading">
   <div><h2>طلبات الوصول من الموارد البشرية</h2><p>يقدّم HR الطلب، والمشغّل الأساسي يحوّله إلى ملف مراجعة Identity. الصلاحيات المقترحة ليست منحًا فعليًا.</p></div>
   <button type="button" className="button button-secondary" disabled={loading||!!busy} onClick={()=>void reload()}>تحديث</button>
  </div>
  {notice?<p role="status">{notice}</p>:null}
  {error?<p role="alert">{error}</p>:null}
  <div className="access-table-wrap"><table className="operations-table access-table">
   <thead><tr><th scope="col">الموظف</th><th scope="col">المسمى / القسم</th><th scope="col">السبب</th><th scope="col">الصلاحيات المقترحة</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead>
   <tbody>
    {items.map((item)=><tr key={item.id}>
     <th scope="row">{item.employeeName}</th><td>{item.jobTitle} — {item.department}</td><td>{item.reason}</td>
     <td>{item.requestedPermissions.join("، ")||"بدون اقتراح"}</td>
     <td>{item.state==="pending_review"?"بانتظار المشغّل الأساسي":"أُحيل إلى Identity"}</td>
     <td>{item.state==="pending_review"?
      <button type="button" className="button button-secondary" disabled={!!busy} onClick={()=>void openProfile(item.id)}>
       {busy===item.id?"جارٍ التحويل…":"إنشاء ملف مراجعة"}
      </button>:"تابع الاعتماد في القائمة أدناه"}</td>
    </tr>)}
    {!loading&&items.length===0?<tr><td colSpan={6}>لا توجد طلبات وصول.</td></tr>:null}
    {loading?<tr><td colSpan={6}>جارٍ تحميل الطلبات…</td></tr>:null}
   </tbody>
  </table></div>
  <div className="form-actions">
   <button type="button" className="button button-secondary" disabled={loading||previous.length===0} onClick={()=>{const history=[...previous];setCursor(history.pop()??"");setPrevious(history)}}>السابق</button>
   <button type="button" className="button button-secondary" disabled={loading||!next} onClick={()=>{setPrevious((v)=>[...v,cursor]);setCursor(next)}}>التالي</button>
  </div>
 </section>;
}
