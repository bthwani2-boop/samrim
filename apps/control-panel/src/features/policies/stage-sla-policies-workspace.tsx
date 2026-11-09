"use client";
import { useEffect,useRef,useState } from "react";
import { useSession } from "../../session/session-provider";
type Mode="BTHWANI_CAPTAIN"|"PARTNER_CAPTAIN"|"CUSTOMER_PICKUP";
type Stage="CREATED"|"PARTNER_ACCEPTED"|"PREPARING"|"READY_FOR_DISPATCH"|"READY_FOR_PICKUP"|"CAPTAIN_ASSIGNED"|"IN_CUSTODY";
type Policy={fulfillmentMode:Mode;stage:Stage;targetMinutes:number;warningMinutes:number;version:number;effectiveAt:string};
const modes:[Mode,string][]=[["BTHWANI_CAPTAIN","توصيل بثواني"],["PARTNER_CAPTAIN","توصيل المتجر"],["CUSTOMER_PICKUP","استلام العميل"]];
const stages:[Stage,string][]=[["CREATED","انتظار المتجر"],["PARTNER_ACCEPTED","قبول المتجر"],["PREPARING","التجهيز"],["READY_FOR_DISPATCH","جاهز للتوزيع"],["READY_FOR_PICKUP","جاهز لاستلام العميل"],["CAPTAIN_ASSIGNED","الكابتن في طريق الاستلام"],["IN_CUSTODY","التوصيل بعد الاستلام"]];
function allowed(mode:Mode,stage:Stage){
 if(mode==="CUSTOMER_PICKUP")return !["READY_FOR_DISPATCH","CAPTAIN_ASSIGNED","IN_CUSTODY"].includes(stage);
 return stage!=="READY_FOR_PICKUP" && !(mode==="PARTNER_CAPTAIN"&&stage==="READY_FOR_DISPATCH");
}
function validPolicies(value:unknown):value is Policy[]{
 if(!Array.isArray(value)||value.length>21)return false;
 const keys=new Set<string>();
 return value.every((item:unknown)=>{
  if(!item||typeof item!=="object"||!("fulfillmentMode" in item)||!("stage" in item)||
    !("targetMinutes" in item)||!("warningMinutes" in item)||!("version" in item)||!("effectiveAt" in item))return false;
  const p=item as Policy;
  if(!modes.some(([m])=>m===p.fulfillmentMode)||!stages.some(([s])=>s===p.stage)||!allowed(p.fulfillmentMode,p.stage)||
    !Number.isSafeInteger(p.targetMinutes)||p.targetMinutes<1||p.targetMinutes>1440||
    !Number.isSafeInteger(p.warningMinutes)||p.warningMinutes<0||p.warningMinutes>=p.targetMinutes||
    !Number.isSafeInteger(p.version)||p.version<1||typeof p.effectiveAt!=="string")return false;
  const key=JSON.stringify([p.fulfillmentMode,p.stage]);
  if(keys.has(key))return false;
  keys.add(key);return true;
 });
}
export function StageSLAPoliciesWorkspace(){
 const {state}=useSession();
 if(state.kind!=="authenticated"||state.identity.role!=="operator"||
   state.identity.permissions?.includes("platform_policies")!==true||
   !state.identity.subject||!state.identity.sessionId)
   return <p role="alert">تتطلب الإدارة جلسة مشغّل فعّالة وصلاحية سياسات المنصة.</p>;
 const key=JSON.stringify([state.identity.subject,state.identity.sessionId,state.identity.role,
  [...(state.identity.permissions??[])].sort((a,b)=>a.localeCompare(b))]);
 return <StageSLAPolicyEditor key={key}/>;
}
function StageSLAPolicyEditor(){
 const {state}=useSession();
 const authorized=state.kind==="authenticated"&&state.identity.role==="operator"&&state.identity.permissions?.includes("platform_policies")===true;
 const [policies,setPolicies]=useState<Policy[]>([]);
 const [loading,setLoading]=useState(true);
 const [mode,setMode]=useState<Mode>("BTHWANI_CAPTAIN");
 const [stage,setStage]=useState<Stage>("CREATED");
 const [target,setTarget]=useState("");
 const [warning,setWarning]=useState("");
 const [saving,setSaving]=useState(false);
 const [readReady,setReadReady]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const inFlightSave=useRef<AbortController|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const selected=policies.find(p=>p.fulfillmentMode===mode&&p.stage===stage);
 useEffect(()=>()=>{inFlightSave.current?.abort();inFlightSave.current=null;},[]);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setReadReady(false);setPolicies([]);setError("");setNotice("");
  if(!authorized){setLoading(false);return()=>controller.abort();}
  void (async()=>{
   try{
    const res=await fetch("/api/policies/stage-sla",{cache:"no-store",
     signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12_000)])});
    const body:unknown=await res.json();
    if(!res.ok||!body||typeof body!=="object"||!("items" in body)||
      !validPolicies(body.items))throw new Error("تعذرت قراءة السياسات");
    if(!controller.signal.aborted){setPolicies(body.items);setReadReady(true);inFlightSave.current=null;}
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"تعذر الاتصال");}
   finally{if(!controller.signal.aborted)setLoading(false)}
  })();
  return ()=>controller.abort();
 },[authorized,refresh]);
 useEffect(()=>{
  // Refresh numeric fields from the canonical policy without erasing a save notice.
  setTarget(selected?String(selected.targetMinutes):"");
  setWarning(selected?String(selected.warningMinutes):"");
 },[selected,mode,stage]);
 useEffect(()=>{
  setError("");setNotice("");
 },[mode,stage]);
 const targetValue=Number(target),warningValue=Number(warning);
 const valid=target.trim()!==""&&warning.trim()!==""&&Number.isInteger(targetValue)&&Number.isInteger(warningValue)&&targetValue>=1&&targetValue<=1440&&warningValue>=0&&warningValue<targetValue;
 async function approve(){
  if(!authorized||!readReady||!valid||saving||inFlightSave.current)return;
  if(!window.confirm("اعتماد مهلة جديدة للمراحل القادمة فقط؟"))return;
  const controller=new AbortController();
  inFlightSave.current=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]);
  const requestedMode=mode,requestedStage=stage;
  const requestedTarget=targetValue,requestedWarning=warningValue;
  const expectedVersion=selected?.version??0;
  setSaving(true);setError("");setNotice("");
  let confirmedSuccess=false;
  try{
   const response=await fetch("/api/policies/stage-sla",{
    method:"POST",signal,
    headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({fulfillmentMode:requestedMode,stage:requestedStage,
      targetMinutes:requestedTarget,warningMinutes:requestedWarning,expectedVersion})
   });
   const result=await response.json() as {policy?:Policy;error?:{message?:string;code?:string}};
   if(controller.signal.aborted)return;
   const proposed=result.policy;
   if(!response.ok||!proposed||proposed.fulfillmentMode!==requestedMode||
     proposed.stage!==requestedStage||proposed.targetMinutes!==requestedTarget||
     proposed.warningMinutes!==requestedWarning||proposed.version!==expectedVersion+1)
     throw new Error("نتيجة الاعتماد غير مؤكدة");
   const read=await fetch("/api/policies/stage-sla",{cache:"no-store",signal});
   const body:unknown=await read.json();
   if(controller.signal.aborted)return;
   if(!read.ok||!body||typeof body!=="object"||!("items" in body)||
     !validPolicies(body.items))throw new Error("نتيجة غير مؤكدة");
   const confirmed=body.items.find(p=>p.fulfillmentMode===requestedMode&&p.stage===requestedStage);
   if(!confirmed||confirmed.version!==proposed.version||confirmed.targetMinutes!==requestedTarget||
     confirmed.warningMinutes!==requestedWarning)throw new Error("نتيجة غير مؤكدة");
   setPolicies(body.items);setReadReady(true);
   confirmedSuccess=true;
   setNotice("اعتماد النسخة "+confirmed.version+" مثبت بقراءة DSH");
  }catch{
   if(!controller.signal.aborted){
    // A POST may have committed; the prior version is no longer actionable.
    setPolicies([]);setReadReady(false);
    setError("تعذر تأكيد نتيجة الاعتماد. أعد قراءة المهل من DSH قبل أي تعديل جديد.");
   }
  }finally{
   // After an ambiguous POST, retain the existing ref as a synchronous no-retry gate
   // until the operator explicitly reads the canonical DSH policy again.
   if(confirmedSuccess&&inFlightSave.current===controller)inFlightSave.current=null;
   if(!controller.signal.aborted)setSaving(false);
  }
 }
 return <section className="workspace-page policy-studio" aria-label="مهل مراحل الطلب">
  <header><a href="/policies">السياسات</a><h1>مهل مراحل الطلب</h1>
   <p className="muted">فقط المهل التي يعتمدها مشغّل مخوّل. لا تتغير الطلبات السابقة أو الأموال.</p></header>
  {!authorized?<p role="alert">تتطلب الإدارة صلاحية سياسات المنصة.</p>:loading?<p role="status">جارٍ قراءة المهل…</p>:<>
   <div className="policy-rich-toolbar">
    <label>نمط التسليم <select value={mode} disabled={saving||!readReady} onChange={e=>{const next=e.target.value as Mode;setMode(next);if(!allowed(next,stage))setStage("CREATED")}}>
     {modes.map(m=><option key={m[0]} value={m[0]}>{m[1]}</option>)}</select></label>
    <label>المرحلة <select value={stage} disabled={saving||!readReady} onChange={e=>setStage(e.target.value as Stage)}>
     {stages.filter(x=>allowed(mode,x[0])).map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
   </div>
   <p className="muted">{selected?"النسخة المعتمدة "+selected.version+" · "+new Date(selected.effectiveAt).toLocaleString("ar-YE"):"لا توجد مهلة معتمدة لهذه المرحلة"}</p>
   <form onSubmit={e=>{e.preventDefault();void approve()}} className="policy-rich-toolbar">
    <label>المدة بالدقائق <input type="number" min={1} max={1440} required value={target} disabled={saving||!readReady} onChange={e=>setTarget(e.target.value)}/></label>
    <label>التحذير قبل الانتهاء (دقيقة) <input type="number" min={0} max={1439} required value={warning} disabled={saving||!readReady} onChange={e=>setWarning(e.target.value)}/></label>
    <button type="submit" className="button button-primary" disabled={!readReady||!valid||saving}>{saving?"جارٍ الاعتماد…":"اعتماد مهلة المرحلة"}</button>
   </form>
   {error?<p role="alert">{error}</p>:null}
   {!readReady?<button type="button" className="button button-secondary" disabled={saving}
      onClick={()=>setRefresh(n=>n+1)}>إعادة قراءة المهل من DSH</button>:null}
   {notice?<p role="status">{notice}</p>:null}
   <p className="muted">كل تعديل يُنشئ نسخة مؤرخة، ولا يُعدّل مدة مرحلة بدأت سابقًا.</p>
  </>}
 </section>;
}
