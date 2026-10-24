"use client";
import { useEffect,useState } from "react";
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
export function StageSLAPoliciesWorkspace(){
 const {state}=useSession();
 const authorized=state.kind==="authenticated"&&state.identity.role==="operator"&&state.identity.permissions?.includes("platform_policies");
 const [policies,setPolicies]=useState<Policy[]>([]);
 const [loading,setLoading]=useState(true);
 const [mode,setMode]=useState<Mode>("BTHWANI_CAPTAIN");
 const [stage,setStage]=useState<Stage>("CREATED");
 const [target,setTarget]=useState("");
 const [warning,setWarning]=useState("");
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const selected=policies.find(p=>p.fulfillmentMode===mode&&p.stage===stage);
 useEffect(()=>{
  const controller=new AbortController();
  if(!authorized){setLoading(false);return;}
  void (async()=>{
   try{
    const res=await fetch("/api/policies/stage-sla",{cache:"no-store",signal:controller.signal});
    const body=await res.json() as {items?:Policy[]};
    if(!res.ok||!Array.isArray(body.items))throw new Error("تعذرت قراءة السياسات");
    if(!controller.signal.aborted)setPolicies(body.items);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"تعذر الاتصال");}
   finally{if(!controller.signal.aborted)setLoading(false)}
  })();
  return ()=>controller.abort();
 },[authorized]);
 useEffect(()=>{
  void mode; void stage; // Reset editor when policy selection changes.
  setTarget(selected?String(selected.targetMinutes):"");
  setWarning(selected?String(selected.warningMinutes):"");
  setError("");setNotice("");
 },[selected,mode,stage]);
 const targetValue=Number(target),warningValue=Number(warning);
 const valid=target.trim()!==""&&warning.trim()!==""&&Number.isInteger(targetValue)&&Number.isInteger(warningValue)&&targetValue>=1&&targetValue<=1440&&warningValue>=0&&warningValue<targetValue;
 async function approve(){
  if(!authorized||!valid||saving)return;
  if(!window.confirm("اعتماد مهلة جديدة للمراحل القادمة فقط؟"))return;
  setSaving(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/policies/stage-sla",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({fulfillmentMode:mode,stage,targetMinutes:targetValue,warningMinutes:warningValue,expectedVersion:selected?.version??0})
   });
   const result=await response.json() as {policy?:Policy;error?:{message?:string;code?:string}};
   if(!response.ok||!result.policy)throw new Error(result.error?.message||"تعذر اعتماد المهلة");
   const read=await fetch("/api/policies/stage-sla",{cache:"no-store"});
   const body=await read.json() as {items?:Policy[]};
   if(!read.ok||!Array.isArray(body.items))throw new Error("نتيجة غير مؤكدة. تحقّق قبل إعادة المحاولة");
   const confirmed=body.items.find(p=>p.fulfillmentMode===mode&&p.stage===stage);
   if(!confirmed||confirmed.version!==result.policy.version||confirmed.targetMinutes!==targetValue||confirmed.warningMinutes!==warningValue)
    throw new Error("لم تتطابق نتيجة الاعتماد. لا تعِد الإرسال قبل التحقق");
   setPolicies(body.items);setNotice("اعتماد النسخة "+confirmed.version+" مثبت بقراءة DSH");
  }catch(e){setError(e instanceof Error?e.message:"تعذر التأكد من النتيجة");}
  finally{setSaving(false)}
 }
 return <section className="workspace-page policy-studio" aria-label="مهل مراحل الطلب">
  <header><a href="/policies">السياسات</a><h1>مهل مراحل الطلب</h1>
   <p className="muted">فقط المهل التي يعتمدها مشغّل مخوّل. لا تتغير الطلبات السابقة أو الأموال.</p></header>
  {!authorized?<p role="alert">تتطلب الإدارة صلاحية سياسات المنصة.</p>:loading?<p role="status">جارٍ قراءة المهل…</p>:<>
   <div className="policy-rich-toolbar">
    <label>نمط التسليم <select value={mode} onChange={e=>{const next=e.target.value as Mode;setMode(next);if(!allowed(next,stage))setStage("CREATED")}}>
     {modes.map(m=><option key={m[0]} value={m[0]}>{m[1]}</option>)}</select></label>
    <label>المرحلة <select value={stage} onChange={e=>setStage(e.target.value as Stage)}>
     {stages.filter(x=>allowed(mode,x[0])).map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
   </div>
   <p className="muted">{selected?"النسخة المعتمدة "+selected.version+" · "+new Date(selected.effectiveAt).toLocaleString("ar-YE"):"لا توجد مهلة معتمدة لهذه المرحلة"}</p>
   <form onSubmit={e=>{e.preventDefault();void approve()}} className="policy-rich-toolbar">
    <label>المدة بالدقائق <input type="number" min={1} max={1440} required value={target} onChange={e=>setTarget(e.target.value)}/></label>
    <label>التحذير قبل الانتهاء (دقيقة) <input type="number" min={0} max={1439} required value={warning} onChange={e=>setWarning(e.target.value)}/></label>
    <button type="submit" className="button button-primary" disabled={!valid||saving}>{saving?"جارٍ الاعتماد…":"اعتماد مهلة المرحلة"}</button>
   </form>
   {error?<p role="alert">{error}</p>:null}
   {notice?<p role="status">{notice}</p>:null}
   <p className="muted">كل تعديل يُنشئ نسخة مؤرخة، ولا يُعدّل مدة مرحلة بدأت سابقًا.</p>
  </>}
 </section>;
}
