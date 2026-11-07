"use client";

import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";

type Model="BTHWANI_PARTNER"|"INDEPENDENT_STORE";
type Policy={relationModel:Model;enrollmentEnabled:boolean;version:number;updatedBy:string;updatedAt:string;reason:string};
const path="/api/policies/store-joining";
const labels:Record<Model,string>={BTHWANI_PARTNER:"شريك بثواني",INDEPENDENT_STORE:"متجر مستقل"};

export function StoreJoiningPolicyWorkspace(){
 const {state}=useSession();
 const authorized=state.kind==="authenticated"&&state.identity.role==="operator"&&state.identity.permissions?.includes("platform_policies")===true;
 const [policies,setPolicies]=useState<Policy[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [selected,setSelected]=useState<Model>("BTHWANI_PARTNER");
 const [enabled,setEnabled]=useState(true);
 const [reason,setReason]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const current=policies.find(p=>p.relationModel===selected);

 useEffect(()=>{
  if(!authorized){setLoading(false);return;}
  const controller=new AbortController();
  void (async()=>{
   try{
    const response=await fetch(path,{cache:"no-store",signal:controller.signal});
    const body=await response.json() as {items?:Policy[]};
    if(!response.ok||!Array.isArray(body.items)||body.items.length!==2)throw Error("تعذرت قراءة سياسة الانضمام.");
    if(!controller.signal.aborted){
      setPolicies(body.items);
      setEnabled(body.items.find(item=>item.relationModel==="BTHWANI_PARTNER")?.enrollmentEnabled??false);
    }
   }catch{
    if(!controller.signal.aborted)setError("تعذرت قراءة السياسات من الخدمة. لا يمكن تعديلها الآن.");
   }finally{if(!controller.signal.aborted)setLoading(false)}
  })();
  return ()=>controller.abort();
 },[authorized]);

 async function save(){
  if(!authorized||!current||saving||enabled===current.enrollmentEnabled||reason.trim().length<5)return;
  if(!window.confirm(enabled?"فتح إنشاء متاجر جديدة لهذا النموذج؟":"إيقاف إنشاء متاجر جديدة بهذا النموذج؟ المتاجر القائمة لن تتوقف."))return;
  setSaving(true);setError("");setNotice("");
  try{
   const response=await fetch(path,{method:"PUT",
    headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({relationModel:selected,enrollmentEnabled:enabled,expectedVersion:current.version,reason:reason.trim()})
   });
   const body=await response.json() as {policy?:Policy;error?:{message?:string}};
   if(!response.ok||!body.policy)throw Error(body.error?.message||"تعذر اعتماد السياسة.");
   const confirmedResponse=await fetch(path,{cache:"no-store"});
   const confirmedBody=await confirmedResponse.json() as {items?:Policy[]};
   const confirmed=confirmedBody.items?.find(item=>item.relationModel===selected);
   if(!confirmedResponse.ok||!confirmed||confirmed.version!==body.policy.version||confirmed.enrollmentEnabled!==enabled)
    throw Error("النتيجة غير مؤكدة. أعد قراءة السياسة قبل محاولة التغيير مجددًا.");
   setPolicies(confirmedBody.items!);
   setReason("");
   setNotice("تم اعتماد سياسة الانضمام بالإصدار "+confirmed.version+" بعد القراءة من DSH.");
  }catch(e){setError(e instanceof Error?e.message:"تعذّر التأكد من الحفظ.");}
  finally{setSaving(false)}
 }
 return <section className="workspace-page policy-studio" aria-label="انضمام المتاجر">
  <h2>سياسات انضمام المتاجر</h2>
  <p className="muted">تحدد هذه السياسة إتاحة إنشاء متاجر جديدة فقط. لا توقف المتاجر القائمة ولا تغير نشرها أو اتفاقاتها.</p>
  {!authorized?<p role="alert">يتطلب التعديل صلاحية سياسات المنصة.</p>:loading?<p role="status">جارٍ قراءة السياسات…</p>:policies.length!==2?<p role="alert">{error||"السياسات غير متاحة."}</p>:<>
   <div className="policy-rich-toolbar">
    <label>نموذج المتجر
     <select value={selected} onChange={e=>{
       const model=e.target.value as Model;
       setSelected(model);
       setEnabled(policies.find(item=>item.relationModel===model)?.enrollmentEnabled??false);
       setReason("");setError("");setNotice("");
      }} disabled={saving}>
      {(Object.keys(labels) as Model[]).map(model=><option value={model} key={model}>{labels[model]}</option>)}
     </select>
    </label>
    <label>إتاحة إنشاء متجر جديد
     <select value={enabled?"enabled":"disabled"} onChange={e=>setEnabled(e.target.value==="enabled")} disabled={saving}>
      <option value="enabled">متاح</option><option value="disabled">متوقف</option>
     </select>
    </label>
   </div>
   <p className="muted">النسخة الحالية: {current?.version} · آخر تعديل: {current?.updatedAt?new Date(current.updatedAt).toLocaleString("ar-YE"):"غير معروف"}.</p>
   <p className="muted">سياسة مراجعة النشر: {selected==="BTHWANI_PARTNER"?"المشغّل والمالية قبل النشر":"النشر الذاتي الآمن مستهدف، لكنه غير متاح حتى تكتمل بواباته"}. لا يمكن تجاوز الموافقات الإلزامية من هنا.</p>
   <form onSubmit={e=>{e.preventDefault();void save()}} className="policy-rich-toolbar">
    <label>سبب التغيير
     <input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required disabled={saving} placeholder="سبب واضح لاعتماد التغيير"/>
    </label>
    <button type="submit" className="button button-primary" disabled={saving||!current||enabled===current.enrollmentEnabled||reason.trim().length<5}>
      {saving?"جارٍ التحقق…":"حفظ سياسة الانضمام"}
    </button>
   </form>
   {error?<p role="alert">{error}</p>:null}
   {notice?<p role="status">{notice}</p>:null}
   <p className="muted">تفرض DSH هذه السياسة على إنشاء المتجر نفسه، حتى عند استدعاء الواجهة البرمجية مباشرة.</p>
  </>}
 </section>;
}
