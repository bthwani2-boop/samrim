"use client";
import { useCallback, useEffect, useState } from "react";
import type { CaptainMinimumBalancePolicy } from "../../server/dsh/dsh-bff";
import { useSession } from "../../session/session-provider";

type State="loading"|"ready"|"missing"|"error";
const endpoint="/api/finance/captain-minimum-balance-policy";
export function CaptainMinimumBalancePolicyWorkspace() {
 const {state:session}=useSession();
 const canEdit=session.kind==="authenticated"&&session.identity.permissions?.includes("platform_policies")===true;
 const [state,setState]=useState<State>("loading");
 const [policy,setPolicy]=useState<CaptainMinimumBalancePolicy|null>(null);
 const [history,setHistory]=useState<readonly CaptainMinimumBalancePolicy[]>([]);
 const [showHistory,setShowHistory]=useState(false);
 const [amount,setAmount]=useState("");
 const [reason,setReason]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const read=useCallback(async()=>{
  setState("loading");
  try{
   const response=await fetch(endpoint,{cache:"no-store"});
   if(response.status===404){
    const b=await response.json() as {error?:{code?:string}};
    if(b.error?.code!=="CAPTAIN_MINIMUM_BALANCE_NOT_CONFIGURED")throw new Error("تعذرت قراءة سياسة رصيد الكابتن.");
    setPolicy(null);setState("missing");return;
   }
   const body=await response.json() as {policy?:CaptainMinimumBalancePolicy;error?:{message?:string}};
   if(!response.ok||!body.policy)throw new Error(body.error?.message||"تعذرت قراءة سياسة رصيد الكابتن.");
   setPolicy(body.policy);setAmount(String(body.policy.minimumAvailableMinor));setState("ready");
  }catch(e){setState("error");setError(e instanceof Error?e.message:"تعذرت قراءة السياسة");}
 },[]);
 const readHistory=useCallback(async()=>{
  try{
   const res=await fetch(endpoint+"?history=true",{cache:"no-store"});
   const body=await res.json() as {items?:CaptainMinimumBalancePolicy[]};
   if(!res.ok||!Array.isArray(body.items))throw new Error("تعذرت قراءة سجل الإصدارات");
   setHistory(body.items);
  }catch(e){setError(e instanceof Error?e.message:"تعذرت قراءة السجل");}
 },[]);
 useEffect(()=>{void read()},[read]);
 const minimum=Number(amount);
 const valid=Number.isSafeInteger(minimum)&&minimum>0&&reason.trim().length>=5&&reason.trim().length<=500;
 async function save(){
  if(!canEdit||!valid||(state!=="ready"&&state!=="missing"))return;
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({minimumAvailableMinor:minimum,expectedVersion:policy?.version??0,reason:reason.trim()})});
   const body=await response.json() as {error?:{message?:string}};
   if(!response.ok)throw new Error(body.error?.message||"تعذر حفظ حد الرصيد");
   await read();setReason("");
   setNotice("تم اعتماد الحد الأدنى وقراءة نتيجته من WLT.");
   window.dispatchEvent(new CustomEvent("policy:changed",{detail:{key:"captain-minimum-balance"}}));
   if(showHistory)await readHistory();
  }catch(e){setError(e instanceof Error?e.message:"تعذر حفظ السياسة");}
  finally{setBusy(false);}
 }
 return <section className="form-section" aria-label="الحد الأدنى لرصيد كابتن بثواني">
  <p className="muted">يسري على كابتن بثواني عند تلقي وقبول جميع طلبات التوصيل: كاش، محفظة، ومختلط. يعتمد على الرصيد المتاح في WLT بعد الحجوزات. وتظل تغطية مبلغ الكاش شرطًا مستقلًا.</p>
  {state==="loading"?<p role="status">جارٍ قراءة الحد المعتمد…</p>:null}
  {state==="missing"?<p role="status">لم تُعتمد سياسة الحد الأدنى بعد. يستمر شرط أهلية الكاش السابق حتى اعتماد أول قيمة.</p>:null}
  {state==="ready"&&policy?<div className="policy-version-facts">
   <strong>الحد المعتمد: {policy.minimumAvailableMinor.toLocaleString("ar-YE")} ريال</strong>
   <p>نشط · الإصدار {policy.version} · {new Date(policy.createdAt).toLocaleString("ar-YE")}</p>
   <p>معرّف المفعّل: <bdi dir="ltr">{policy.createdBy}</bdi></p>
  </div>:null}
  {state==="error"?<p role="alert">{error||"تعذرت القراءة، التعديل معطل."}</p>:null}
  {(state==="ready"||state==="missing")?<div className="form-grid">
   <label className="field-label" htmlFor="captain-min-balance">الحد الأدنى للرصيد المتاح (ريال)
    <input id="captain-min-balance" type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} disabled={!canEdit||busy} />
   </label>
   <label className="field-label" htmlFor="captain-min-reason">سبب الاعتماد أو التعديل
    <textarea id="captain-min-reason" rows={2} minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={!canEdit||busy}/>
   </label>
   {canEdit?<button type="button" className="button button-primary" onClick={()=>void save()} disabled={!valid||busy}>{busy?"جارٍ التفعيل…":policy?"اعتماد الحد المعدل":"اعتماد أول حد"}</button>:null}
  </div>:null}
  {notice?<p role="status" className="success">{notice}</p>:null}
  {error&&state!=="error"?<p role="alert" className="validation-error">{error}</p>:null}
  <button type="button" className="button button-secondary" onClick={()=>{setShowHistory(x=>!x);if(!showHistory)void readHistory()}}>{showHistory?"إخفاء سجل التغييرات":"عرض سجل التغييرات"}</button>
  {showHistory?<ol className="policy-min-history">{history.map(item=><li key={item.id}>
   <strong>v{item.version} — {item.minimumAvailableMinor.toLocaleString("ar-YE")} ريال</strong>
   <span> · {item.state==="ACTIVE"?"سارٍ":"سابق"} · {new Date(item.createdAt).toLocaleString("ar-YE")}</span>
   <p>{item.changeReason} — <bdi dir="ltr">{item.createdBy}</bdi></p>
  </li>)}</ol>:null}
 </section>;
}
