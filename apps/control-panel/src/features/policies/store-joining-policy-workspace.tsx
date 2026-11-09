"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { validStoreJoiningPolicyReadback, type StoreJoiningModel as Model, type StoreJoiningPolicy as Policy } from "./store-joining-policy-readback";

const path="/api/policies/store-joining";
const labels:Record<Model,string>={BTHWANI_PARTNER:"شريك بثواني",INDEPENDENT_STORE:"متجر مستقل"};

export function StoreJoiningPolicyWorkspace(){
 const {state}=useSession();
 const authorized=state.kind==="authenticated"&&state.identity.role==="operator"&&state.identity.permissions?.includes("platform_policies")===true;
 const actorSession=state.kind==="authenticated"?JSON.stringify([state.identity.subject,state.identity.sessionId]):"";
 const [policies,setPolicies]=useState<Policy[]>([]);
 const [loadedSession,setLoadedSession]=useState("");
 const [refresh,setRefresh]=useState(0);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [selected,setSelected]=useState<Model>("BTHWANI_PARTNER");
 const [enabled,setEnabled]=useState(true);
 const [reason,setReason]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const inFlightSave=useRef<AbortController|null>(null);
 const readbackReady=authorized&&loadedSession===actorSession&&policies.length===2;
 const current=readbackReady?policies.find(p=>p.relationModel===selected):undefined;

 // Selection is a client-side view of one canonical DSH response. Changing
 // models must not issue a competing GET, and new readback resets the draft.
 useEffect(()=>{
  if(readbackReady)setEnabled(current?.enrollmentEnabled??false);
 },[readbackReady,current]);

 // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the explicit operator retry after a failed or ambiguous canonical read.
 useEffect(()=>{
  setPolicies([]);setLoadedSession("");setLoading(true);setError("");setNotice("");setSaving(false);
  if(!authorized){setLoading(false);return;}
  const controller=new AbortController();
  void (async()=>{
   try{
    const response=await fetch(path,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12_000)])});
    const body=await response.json() as {items?:Policy[]};
    if(!response.ok||!validStoreJoiningPolicyReadback(body.items))
      throw Error("تعذرت قراءة سياسة الانضمام.");
    if(!controller.signal.aborted){
      setPolicies(body.items);
      setLoadedSession(actorSession);
    }
   }catch{
    if(!controller.signal.aborted)setError("تعذرت قراءة السياسات من الخدمة. لا يمكن تعديلها الآن.");
   }finally{if(!controller.signal.aborted)setLoading(false)}
  })();
  return ()=>{
   controller.abort();
   // A PUT may have committed before cancellation; never replay it implicitly.
   inFlightSave.current?.abort();
   inFlightSave.current=null;
  };
 },[authorized,actorSession,refresh]);

 async function save(){
  if(!readbackReady||!current||saving||inFlightSave.current||enabled===current.enrollmentEnabled||reason.trim().length<5)return;
  if(!window.confirm(enabled?"فتح إنشاء متاجر جديدة لهذا النموذج؟":"إيقاف إنشاء متاجر جديدة بهذا النموذج؟ المتاجر القائمة لن تتوقف."))return;
  const controller=new AbortController();
  const requestSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]);
  inFlightSave.current=controller;
  setSaving(true);setError("");setNotice("");
  try{
   const response=await fetch(path,{method:"PUT",signal:requestSignal,
    headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({relationModel:selected,enrollmentEnabled:enabled,expectedVersion:current.version,reason:reason.trim()})
   });
   const body=await response.json() as {policy?:Policy;error?:{message?:string}};
   if(controller.signal.aborted)return;
   if(!response.ok||!body.policy)throw Error(body.error?.message||"تعذر اعتماد السياسة.");
   const confirmedResponse=await fetch(path,{cache:"no-store",signal:requestSignal});
   const confirmedBody=await confirmedResponse.json() as {items?:Policy[]};
   if(controller.signal.aborted)return;
   const confirmed=confirmedBody.items?.find(item=>item.relationModel===selected);
   if(!confirmedResponse.ok||!validStoreJoiningPolicyReadback(confirmedBody.items)||!confirmed||confirmed.version!==body.policy.version||confirmed.enrollmentEnabled!==enabled)
    throw Error("النتيجة غير مؤكدة. أعد قراءة السياسة قبل محاولة التغيير مجددًا.");
   setPolicies(confirmedBody.items!);
   setLoadedSession(actorSession);
   setEnabled(confirmed.enrollmentEnabled);
   setReason("");
   setNotice("تم اعتماد سياسة الانضمام بالإصدار "+confirmed.version+" بعد القراءة من DSH.");
  }catch{
   if(controller.signal.aborted)return;
   // The PUT might have committed even if its response or readback was lost.
   // Block a second write until a fresh DSH read establishes the latest version.
   setPolicies([]);setLoadedSession("");
   setError("تعذر تأكيد نتيجة تغيير السياسة. أعد قراءة الحالة من DSH قبل أي محاولة جديدة.");
  }
  finally{
   if(inFlightSave.current===controller)inFlightSave.current=null;
   if(!controller.signal.aborted)setSaving(false);
  }
 }
 return <section className="workspace-page policy-studio" aria-label="انضمام المتاجر">
  <h2>سياسات انضمام المتاجر</h2>
  <p className="muted">تحدد هذه السياسة إتاحة إنشاء متاجر جديدة فقط. لا توقف المتاجر القائمة ولا تغير نشرها أو اتفاقاتها.</p>
  {!authorized?<p role="alert">يتطلب التعديل صلاحية سياسات المنصة.</p>:loading?<p role="status">جارٍ قراءة السياسات…</p>:!readbackReady?<div className="state-card" role="alert"><p>{error||"السياسات غير متاحة أو تحتاج إعادة قراءة."}</p><button type="button" onClick={()=>setRefresh(value=>value+1)}>إعادة قراءة السياسات</button></div>:<>
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
