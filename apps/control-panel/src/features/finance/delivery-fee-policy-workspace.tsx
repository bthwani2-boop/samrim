"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DistanceFeePolicy, DistanceFeeBand } from "../../server/dsh/dsh-bff";
import { useSession } from "../../session/session-provider";

type City = Readonly<{id:string;displayNameAr:string;active:boolean}>;
type Row = Readonly<{id:string;limitKm:string;rate:string}>;
type ReadState = "loading"|"ready"|"missing"|"error";
const endpoint="/api/finance/distance-band-fee-policy";
const emptyRows=():Row[]=>[{id:"new-band-0",limitKm:"",rate:""}];
const format=(value:number)=>new Intl.NumberFormat("ar-YE",{maximumFractionDigits:2}).format(value);

function rowsFromPolicy(p:DistanceFeePolicy):Row[]{
 if(!Array.isArray(p.distanceBands)||p.distanceBands.length===0)return emptyRows();
 return p.distanceBands.map((b,index)=>({id:`${p.id}-${index}`,limitKm:b.upToMeters===null?"":String(b.upToMeters/1000),rate:String(b.ratePerKmMinor)}));
}
function normalizedBands(rows:readonly Row[]):DistanceFeeBand[]|null{
 if(!rows.length||rows.length>30)return null;
 let previous=0;
 const result:DistanceFeeBand[]=[];
 for(let index=0;index<rows.length;index++){
  const row=rows[index]!;
  const rate=Number(row.rate);
  if(!row.rate.trim()||!Number.isSafeInteger(rate)||rate<=0||rate>100000000)return null;
  let upper:number|null=null;
  if(index!==rows.length-1){
   upper=Number(row.limitKm)*1000;
   if(!row.limitKm.trim()||!Number.isSafeInteger(upper)||upper<=previous||upper>500000)return null;
   previous=upper;
  }
  result.push({upToMeters:upper,ratePerKmMinor:rate});
 }
 return result;
}
function previewQuote(km:string,bands:readonly DistanceFeeBand[]|null):number|null{
 if(!bands||!km.trim())return null;
 const meters=Number(km)*1000;
 if(!Number.isSafeInteger(meters)||meters<0||meters>500000)return null;
 let previous=0,amount=0;
 for(const band of bands){
  if(meters<=previous)break;
  const end=band.upToMeters===null?meters:Math.min(meters,band.upToMeters);
  amount+=(end-previous)*band.ratePerKmMinor/1000;
  previous=end;
 }
 return Math.ceil(amount);
}
export function DeliveryFeePolicyWorkspace(){
 const {state:session}=useSession();
 const canEdit=session.kind==="authenticated"&&session.identity.permissions?.includes("platform_policies")===true;
 const [cities,setCities]=useState<City[]>([]);
 const [city,setCity]=useState("");
 const [policy,setPolicy]=useState<DistanceFeePolicy|null>(null);
 const [rows,setRows]=useState<Row[]>(emptyRows);
 const [reason,setReason]=useState("");
 const [sampleKm,setSampleKm]=useState("1");
 const [readState,setReadState]=useState<ReadState>("loading");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const sequence=useRef(0);

 const read=useCallback(async(scope:string):Promise<DistanceFeePolicy|null>=>{
  const id=++sequence.current;
  setReadState("loading");setError("");setNotice("");
  try{
   const response=await fetch(endpoint+"?serviceCityId="+encodeURIComponent(scope),{cache:"no-store"});
   const payload=await response.json() as {policy?:DistanceFeePolicy;error?:{message?:string}};
   if(id!==sequence.current)return null;
   if(response.status===404){
    setPolicy(null);setRows(emptyRows());setReadState("missing");return null;
   }
   if(!response.ok||!payload.policy)throw new Error(payload.error?.message||"تعذرت قراءة سياسة رسوم التوصيل");
   setPolicy(payload.policy);setRows(rowsFromPolicy(payload.policy));setReadState("ready");
   return payload.policy;
  }catch(e){
   if(id===sequence.current){setReadState("error");setError(e instanceof Error?e.message:"تعذرت قراءة السياسة");}
   return null;
  }
 },[]);
 useEffect(()=>{
  let alive=true;
  void(async()=>{
   const response=await fetch("/api/service-cities",{cache:"no-store"});
   const payload=await response.json() as {cities?:City[]};
   if(!response.ok)throw new Error("تعذرت قراءة مدن الخدمة");
   if(alive)setCities(Array.isArray(payload.cities)?payload.cities:[]);
   await read("");
  })().catch(e=>{
   if(alive){setReadState("error");setError(e instanceof Error?e.message:"تعذرت قراءة مدن الخدمة");}
  });
  return()=>{alive=false;sequence.current+=1};
 },[read]);

 const bands=normalizedBands(rows);
 const quote=previewQuote(sampleKm,bands);
 const active=policy?.distanceBands?.length?true:false;
 const editingAllowed=canEdit&&(readState==="ready"||readState==="missing");
 const canSave=editingAllowed&&!busy&&bands!==null&&reason.trim().length>=5&&reason.trim().length<=500;
 const change=(index:number,key:"limitKm"|"rate",value:string)=>setRows(current=>current.map((r,i)=>i===index?{...r,[key]:value}:r));
 const add=()=>setRows(current=>{
  if(current.length>=30)return current;
  return [...current.slice(0,-1),{...current[current.length-1]!,limitKm:""},{id:crypto.randomUUID(),limitKm:"",rate:""}];
 });
 const remove=(index:number)=>setRows(current=>{
  if(current.length===1)return current;
  const remaining=current.filter((_,i)=>i!==index);
  return remaining.map((r,i)=>i===remaining.length-1?{...r,limitKm:""}:r);
 });

 async function save(){
  if(!canSave||!bands)return;
  const expected=JSON.stringify(bands);
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch(endpoint,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify({serviceCityId:city,distanceBands:bands,expectedVersion:policy?.version??0,reason:reason.trim()}),
   });
   const body=await response.json() as {error?:{message?:string}};
   if(!response.ok)throw new Error(body.error?.message||"تعذر اعتماد شرائح المسافة");
   const confirmed=await read(city);
   if(!confirmed||JSON.stringify(confirmed.distanceBands)!==expected)
    throw new Error("أُرسل الحفظ، لكن تعذرت مطابقة البيانات المعتمدة. أعد القراءة قبل تعديل جديد.");
   setReason("");
   setNotice("تم اعتماد الشرائح والتحقق من WLT");
   window.dispatchEvent(new CustomEvent("policy:changed",{detail:{key:"delivery-fees"}}));
  }catch(e){setError(e instanceof Error?e.message:"تعذر حفظ الشرائح");}
  finally{setBusy(false);}
 }
 return <section className="delivery-tariff" aria-label="إعداد رسوم التوصيل">
  <div className="delivery-tariff-context">
   <label htmlFor="delivery-fee-city">التسعير حسب</label>
   <select id="delivery-fee-city" value={city} disabled={busy} onChange={e=>{setCity(e.target.value);setReason("");void read(e.target.value)}}>
    <option value="">كل مدن الخدمة · القاعدة العامة</option>
    {cities.map(c=><option key={c.id} value={c.id}>{c.displayNameAr}{c.active?"":" · غير نشطة"}</option>)}
   </select>
  </div>
  <div className="delivery-tariff-status">
   <div className="delivery-tariff-current">
    <strong>شرائح سعر الكيلومتر</strong>
    {readState==="ready"&&active&&policy?<span>سارية · إصدار {policy.version}</span>:null}
    {readState==="ready"&&!active||readState==="missing"?<span>لا توجد شرائح معتمدة لهذا النطاق</span>:null}
   </div>
   <button type="button" className="delivery-tariff-reload" disabled={busy||readState==="loading"} onClick={()=>void read(city)}>إعادة القراءة</button>
  </div>
  {readState==="loading"?<p role="status" className="muted">جارٍ قراءة الشرائح…</p>:null}
  {readState==="error"?<p role="alert" className="validation-error">{error}</p>:null}
  {notice?<p role="status" className="success">{notice}</p>:null}
  {editingAllowed?<div className="delivery-tariff-body">
   <div className="delivery-tariff-grid-head" aria-hidden="true">
    <span>من (كم)</span><span>إلى (كم)</span><span>ريال / كم</span><span/>
   </div>
   <ol className="delivery-tariff-tiers" aria-label="شرائح رسوم التوصيل">
    {rows.map((row,index)=><li className="delivery-tariff-tier" key={row.id}>
      <output className="delivery-tariff-from" aria-label={`بداية الشريحة ${index+1}`}>{index===0?"0":rows[index-1]!.limitKm||"—"}</output>
      {index===rows.length-1?<span className="delivery-tariff-unbounded">بلا حد</span>:
       <input type="number" inputMode="decimal" min="0.001" step="0.001"
        aria-label={`نهاية الشريحة ${index+1} بالكيلومتر`} value={row.limitKm}
        onChange={e=>change(index,"limitKm",e.target.value)} disabled={busy||!canEdit} />}
      <input type="number" inputMode="numeric" min="1" step="1"
       aria-label={`سعر الشريحة ${index+1} لكل كيلومتر بالريال`} value={row.rate}
       onChange={e=>change(index,"rate",e.target.value)} disabled={busy||!canEdit}/>
      {canEdit&&rows.length>1?<button type="button" className="delivery-tariff-remove"
       aria-label={`حذف الشريحة ${index+1}`} title="حذف الشريحة"
       onClick={()=>remove(index)} disabled={busy}>×</button>:<span/>}
    </li>)}
   </ol>
   {canEdit?<button type="button" className="delivery-tariff-add" onClick={add} disabled={busy||rows.length>=30}>+ إضافة شريحة</button>:null}
   <p className="delivery-tariff-explain">يُحسب كل جزء من المسافة بسعر شريحته، وآخر شريحة تستمر لأي مسافة. لا رسوم حجم أو منطقة.</p>
   <div className="delivery-tariff-estimate">
    <label htmlFor="delivery-estimate-distance">معاينة لمسافة (كم)
     <input id="delivery-estimate-distance" type="number" inputMode="decimal" min="0" step="0.1" value={sampleKm} onChange={e=>setSampleKm(e.target.value)}/>
    </label>
    <div className="delivery-tariff-estimate-total">
     <small>الرسم المحسوب</small>
     <strong>{quote===null?"—":format(quote)+" ريال"}</strong>
    </div>
   </div>
   <small className="delivery-tariff-estimate-note">معاينة حسابية للقيم المعروضة، وليست تسعيرًا معتمدًا حتى الحفظ.</small>
   {canEdit?<div className="delivery-tariff-commit">
    <label htmlFor="delivery-policy-reason">سبب التعديل
     <textarea id="delivery-policy-reason" rows={2} minLength={5} maxLength={500}
      value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} placeholder="اذكر سبب تغيير الأسعار"/>
    </label>
    {error?<p role="alert" className="validation-error">{error}</p>:null}
    <button type="button" className="button button-primary" disabled={!canSave} onClick={()=>void save()}>
     {busy?"جارٍ الاعتماد…":active?"اعتماد الشرائح المعدلة":"اعتماد الشرائح"}
    </button>
   </div>:null}
  </div>:null}
 </section>;
}
