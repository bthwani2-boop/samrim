"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HRAccessRequest, HRAccessRequestPage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { HRPermissionReview } from "./hr-permission-review";

export function HROperatorAccessQueue() {
 const [items,setItems]=useState<readonly HRAccessRequest[]>([]);
 const [cursor,setCursor]=useState("");
 const [previous,setPrevious]=useState<string[]>([]);
 const [next,setNext]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [selectedId,setSelectedId]=useState("");
 const [rejecting,setRejecting]=useState("");
 const [rejectReason,setRejectReason]=useState("");
 const rejectMutation=useRef<{signature:string;key:string}|null>(null);
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
 async function rejectRequest(item:HRAccessRequest){
  if(busy)return;
  const reason=rejectReason.trim();
  if(reason.length<8||reason.length>500){setError("اكتب سبب رفض واضحًا لا يقل عن 8 أحرف.");return}
  const body={expectedVersion:item.version,reason};
  const signature=JSON.stringify({id:item.id,...body});
  if(rejectMutation.current?.signature!==signature)rejectMutation.current={signature,key:crypto.randomUUID()};
  setBusy(item.id);setError("");setNotice("");
  try{
   const response=await identityFetch(`/api/access/hr-requests/${encodeURIComponent(item.id)}/reject`,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":rejectMutation.current.key},body:JSON.stringify(body),
   });
   if(!response.ok)throw new Error(response.status===409?"تغيرت حالة الطلب؛ حدّث القائمة قبل اتخاذ قرار.":"تعذر رفض الطلب؛ يمكن إعادة المحاولة بالبيانات نفسها.");
   setRejecting("");setRejectReason("");rejectMutation.current=null;
   setNotice("رُفض طلب الوصول وسُجل السبب. يستطيع HR الآن تصحيح الموظف وتقديم طلب جديد.");
   await reload();
  }catch(e){setError(e instanceof Error?e.message:"تعذر رفض الطلب");}
  finally{setBusy("")}
 }
 const selected=items.find((item)=>item.id===selectedId);
 return <section className="access-workspace-section">
  <div className="access-section-heading">
   <div><h2>طلبات الوصول من الموارد البشرية</h2><p>يقدّم HR الطلب، والمشغّل الأساسي يحوّله إلى ملف مراجعة Identity. الصلاحيات المقترحة ليست منحًا فعليًا.</p></div>
   <button type="button" className="button button-secondary" disabled={loading||!!busy} onClick={()=>void reload()}>تحديث</button>
  </div>
  <div className="access-summary-grid">
   <article><span>طلبات الصفحة</span><strong>{items.length}</strong></article>
   <article><span>بانتظار القرار</span><strong>{items.filter((item)=>item.state==="pending_review").length}</strong></article>
   <article><span>قيد إنشاء الهوية</span><strong>{items.filter((item)=>item.state==="identity_provisioning").length}</strong></article>
   <article><span>حسابات مرتبطة</span><strong>{items.filter((item)=>Boolean(item.operatorActorId)).length}</strong></article>
  </div>
  <p className="muted">الأرقام تخص الطلبات المعروضة في الصفحة الحالية فقط، وليست إجماليات جميع السجلات.</p>
  {notice?<p role="status">{notice}</p>:null}
  {error?<p role="alert">{error}</p>:null}
  <div className="access-table-wrap"><table className="operations-table access-table">
   <thead><tr><th scope="col">الموظف</th><th scope="col">المسمى / القسم</th><th scope="col">السبب</th><th scope="col">الصلاحيات المقترحة</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead>
   <tbody>
    {items.map((item)=><tr key={item.id}>
     <th scope="row">{item.employeeName}</th><td>{item.jobTitle} — {item.department}</td><td>{item.reason}</td>
     <td>{item.requestedPermissions.join("، ")||"بدون اقتراح"}</td>
     <td>{item.operatorActorId ? "تم ربط حساب المشغّل" : item.state==="pending_review"?"بانتظار المشغّل الأساسي":item.state==="rejected"?"مرفوض":item.state==="identity_provisioning"?"جارٍ إنشاء ملف المراجعة":"أُحيل إلى Identity"}</td>
      <td><button type="button" className="button button-secondary"
       aria-expanded={selectedId===item.id} onClick={()=>{setSelectedId((id)=>id===item.id?"":item.id);setRejecting("");setError("");}}>
       {selectedId===item.id?"إغلاق التفاصيل":"مراجعة التفاصيل"}
      </button></td>
    </tr>)}
    {!loading&&items.length===0?<tr><td colSpan={6}>لا توجد طلبات وصول. <Link href="/hr/employees">إدارة الموظفين من الموارد البشرية</Link></td></tr>:null}
    {loading?<tr><td colSpan={6}>جارٍ تحميل الطلبات…</td></tr>:null}
   </tbody>
   </table></div>
   {selected?<section className="form-section form-section--w760" aria-label="تفاصيل طلب الوصول">
    <h3>مراجعة طلب {selected.employeeName}</h3>
    <p>المسمى الوظيفي: {selected.jobTitle} — القسم: {selected.department}</p>
    <p>مبرر الوصول: {selected.reason}</p>
    <p>الصلاحيات التي اقترحتها HR: {selected.requestedPermissions.join("، ")||"لم تقترح صلاحيات"}</p>
    <p>حالة الطلب: <strong>{selected.state==="pending_review"?"بانتظار قرار المشغّل الأساسي":selected.state==="rejected"?"مرفوض":selected.state==="identity_provisioning"?"إنشاء ملف Identity قيد الاستكمال":selected.operatorActorId?"تم منح دور المشغّل وربطه بالموظف":"ينتظر اعتماد هوية المشغّل"}</strong></p>
    {selected.rejectionReason?<p>سبب الرفض: {selected.rejectionReason}</p>:null}
    <p className="muted">الخطوة التالية: {selected.state==="pending_review"?"مراجعة البيانات والسبب ثم تحويل الطلب أو رفضه":selected.state==="rejected"?"يمكن لمسؤول HR تصحيح الموظف وإعادة تقديم طلب جديد":selected.state==="identity_provisioning"?"استكمال إنشاء ملف Identity باستخدام الطلب نفسه":selected.operatorActorId?"مراجعة الصلاحيات الممنوحة فعليًا وإدارة الوصول":"اعتماد الملف ومنح الدور وإصدار الدعوة من قائمة المشغّلين"}</p>
    {selected.state==="pending_review"?<div className="form-actions">
     <button type="button" className="button button-primary" disabled={!!busy} onClick={()=>void openProfile(selected.id)}>{busy===selected.id?"جارٍ التحويل…":"تحويل إلى مراجعة Identity"}</button>
     <button type="button" className="button button-secondary" disabled={!!busy} onClick={()=>{setRejecting(selected.id);setRejectReason("");rejectMutation.current=null;}}>رفض الطلب</button>
    </div>:null}
    {selected.state==="identity_provisioning"?<button type="button" className="button button-primary" disabled={!!busy} onClick={()=>void openProfile(selected.id)}>استكمال إنشاء ملف المراجعة</button>:null}
    {rejecting===selected.id&&selected.state==="pending_review"?<div className="form-section form-section--w420">
     <label className="field-label">سبب الرفض
      <textarea required minLength={8} maxLength={500} rows={3} value={rejectReason} onChange={(e)=>{setRejectReason(e.target.value);rejectMutation.current=null}}/>
     </label>
     <div className="form-actions">
      <button type="button" className="button button-secondary" disabled={!!busy||rejectReason.trim().length<8} onClick={()=>void rejectRequest(selected)}>تأكيد الرفض</button>
      <button type="button" className="button button-secondary" disabled={!!busy} onClick={()=>setRejecting("")}>إلغاء</button>
     </div>
    </div>:null}
    {selected.state==="identity_profile_created"?<Link href="/access?view=operators">متابعة إدارة حساب المشغّل</Link>:null}
    {selected.operatorActorId?<HRPermissionReview key={selected.id} request={selected}/>:null}
   </section>:null}
   <div className="form-actions">
   <button type="button" className="button button-secondary" disabled={loading||previous.length===0} onClick={()=>{const history=[...previous];setCursor(history.pop()??"");setPrevious(history)}}>السابق</button>
   <button type="button" className="button button-secondary" disabled={loading||!next} onClick={()=>{setPrevious((v)=>[...v,cursor]);setCursor(next)}}>التالي</button>
  </div>
 </section>;
}
