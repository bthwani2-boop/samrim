"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OperatorCaseAudit } from "./operator-case-audit";
import { formatOperatorCaseAge } from "./operator-case-age";

type OpsCase = Readonly<{
 id:number;orderId:string;reason:string;state:string;priority:string;
 ownerActorId?:string;nextAction:string;version:number;
 resolutionNote?:string;openedAt:string;updatedAt:string;
}>;
type Page = Readonly<{items:ReadonlyArray<OpsCase>;nextCursor:string}>;
const reasons:ReadonlyArray<Readonly<{value:string;label:string}>> = [
 {value:"PARTNER_DELAY",label:"تأخر الشريك"},
 {value:"DISPATCH_UNAVAILABLE",label:"تعذر تعيين كابتن"},
 {value:"DELIVERY_BLOCKED",label:"تعثر التسليم أو العهدة"},
 {value:"CUSTOMER_CONTACT",label:"التواصل مع العميل"},
 {value:"PAYMENT_EXCEPTION",label:"استثناء مالي يحتاج مراجعة"},
 {value:"OTHER",label:"سبب تشغيلي آخر"},
];
const labels:Readonly<Record<string,string>> = {
 OPEN:"تحتاج استلامًا",IN_PROGRESS:"قيد المعالجة",
 ACTION_REQUIRED:"بانتظار إجراء",RESOLVED:"أُغلقت بتوثيق",
};
const urlFor=(orderId:string)=>`/api/operations/${encodeURIComponent(orderId)}/cases`;
export function OperatorOrderCases({orderId,onUpdated}:Readonly<{orderId:string;onUpdated?:(()=>void)|undefined}>) {
 const [items,setItems]=useState<ReadonlyArray<OpsCase>>([]);
 const [nextCursor,setNextCursor]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [expand,setExpand]=useState(false);
 const [reason,setReason]=useState("PARTNER_DELAY");
 const [priority,setPriority]=useState("NORMAL");
 const [nextAction,setNextAction]=useState("");
 const [selected,setSelected]=useState<OpsCase|null>(null);
 const [action,setAction]=useState("NEXT_ACTION");
 const [note,setNote]=useState("");
 const [clock,setClock]=useState<number|null>(null);
 const sequence=useRef(0);
 useEffect(()=>{
   setClock(Date.now());
   const handle=window.setInterval(()=>setClock(Date.now()),60_000);
   return ()=>window.clearInterval(handle);
 },[]);
 const inFlight=useRef(false);
 const attempt=useRef("");
 const read=useCallback(async(cursor=""):Promise<Page>=>{
   const query=new URLSearchParams({limit:"15"});if(cursor)query.set("cursor",cursor);
   const response=await fetch(`${urlFor(orderId)}?${query.toString()}`,
       {cache:"no-store",signal:AbortSignal.timeout(12_000)});
   if(!response.ok)throw new Error("تعذرت قراءة حالات التعثر.");
   const body=await response.json() as Partial<Page>;
   if(!Array.isArray(body.items)||typeof body.nextCursor!=="string"||
     !body.items.every((row)=>row&&row.orderId===orderId&&Number.isSafeInteger(row.id)&&row.id>0&&typeof row.version==="number")) {
     throw new Error("استجابة الحالات غير صالحة.");
   }
   return body as Page;
 },[orderId]);
 const reload=useCallback(async()=>{
   const current=++sequence.current;
   setLoading(true);
   try{
     const page=await read();
     if(current!==sequence.current)return;
     setItems(page.items);setNextCursor(page.nextCursor);setError("");
   }catch{
     if(current===sequence.current){setItems([]);setNextCursor("");setError("تعذرت قراءة حالات التعثر من الخدمة.");}
   }finally{if(current===sequence.current)setLoading(false);}
 },[read]);
 useEffect(()=>{
   setItems([]);setSelected(null);setNotice("");setError("");attempt.current="";
   void reload();
   return ()=>{sequence.current+=1;};
 },[reload]);
 async function submit(kind:"OPEN"|"TRANSITION",row?:OpsCase) {
   if(inFlight.current||loading||busy)return;
   const pendingAction=kind==="OPEN"?"OPEN":action;
   const pendingNote=kind==="OPEN"?nextAction.trim():note.trim();
   if((kind==="OPEN"||pendingAction!=="CLAIM")&&pendingNote.length<12){
     setError("اكتب إجراءً أو نتيجة مراجعة واضحة، لا تقل عن 12 حرفًا.");return;
   }
   inFlight.current=true;setBusy(true);setNotice("");setError("");
   let failureMessage="";
   if(!attempt.current)attempt.current=crypto.randomUUID();
   try{
     const address=kind==="OPEN"?urlFor(orderId):`${urlFor(orderId)}/${row!.id}/transition`;
     const response=await fetch(address,{
       method:"POST",signal:AbortSignal.timeout(12_000),
       headers:{"Content-Type":"application/json","Idempotency-Key":attempt.current},
       body:JSON.stringify(kind==="OPEN"?{reason,priority,nextAction:pendingNote}:
         {action:pendingAction,note:pendingNote,expectedVersion:row!.version}),
     });
     if(!response.ok){
       if(response.status===409||response.status===403)attempt.current="";
       throw new Error(response.status===409?"عُدلت الحالة بواسطة موظف آخر؛ راجع الحالة الحالية.":
        response.status===403?"هذه الحالة مملوكة لموظف آخر أو الصلاحية غير متاحة.":
        "نتيجة الحفظ غير مؤكدة؛ راجع الحالة الحالية قبل إجراء جديد.");
     }
     const body=await response.json() as {item?:OpsCase};
     if(!body.item||body.item.orderId!==orderId)throw new Error("النتيجة غير مؤكدة.");
     attempt.current="";
     setSelected(null);setExpand(false);setNote("");setNextAction("");
     setNotice("حُفظت الحالة بعد تأكيد الخدمة.");
     onUpdated?.();
   }catch(cause){
     failureMessage=cause instanceof Error?cause.message:"تعذّر تأكيد الإجراء.";
   }finally{
     inFlight.current=false;setBusy(false);
     await reload();
     if(failureMessage)setError(failureMessage);
   }
 }
 async function more(){
   if(!nextCursor||busy||loading)return;
   setBusy(true);
   const current=sequence.current;
   try{
     const page=await read(nextCursor);
     if(current===sequence.current){
       setItems(previous=>{
        const ids=new Set(previous.map(x=>x.id));
        return [...previous,...page.items.filter(x=>!ids.has(x.id))];
       });
       setNextCursor(page.nextCursor);
     }
   }catch{setError("تعذر إظهار بقية الحالات.");}
   finally{setBusy(false);}
 }
 function choose(row:OpsCase,selectedAction:string){
   setSelected(row);setAction(selectedAction);setNote("");setError("");setNotice("");attempt.current="";
 }
 return <section className="order-detail-panel" aria-labelledby="ops-cases-title">
   <div className="action-row">
     <h2 id="ops-cases-title">التعثر والمتابعة</h2>
     <button type="button" className="button button-secondary" disabled={busy}
       onClick={()=>{setExpand(v=>!v);setSelected(null);setError("");attempt.current="";}}>
       {expand?"إغلاق الإدخال":"تسجيل تعثر"}
     </button>
   </div>
   {loading&&items.length===0?<p className="muted" role="status">جارٍ قراءة حالات الطلب…</p>:null}
   {items.map(item=><div key={item.id} className="order-detail-panel">
     <strong>{reasons.find(r=>r.value===item.reason)?.label??"حالة تشغيلية"} · {labels[item.state]??item.state}</strong>
     {item.priority==="URGENT"?<span className="operations-attention"> · عاجل</span>:null}
     <p>{item.nextAction}</p>
     <p className="muted">{item.ownerActorId?"المسؤول: "+item.ownerActorId:"لم يُستلم بعد"} · نسخة {item.version}{clock!==null?" · "+formatOperatorCaseAge(item.openedAt,clock):""}</p>
     {item.state==="RESOLVED"&&item.resolutionNote?<p className="muted">النتيجة: {item.resolutionNote}</p>:null}
     {item.state!=="RESOLVED"?<div className="action-row">
        {!item.ownerActorId?<button type="button" className="button button-secondary" disabled={busy} onClick={()=>choose(item,"CLAIM")}>استلام الحالة</button>:null}
        {item.ownerActorId?<button type="button" className="button button-secondary" disabled={busy} onClick={()=>choose(item,"NEXT_ACTION")}>الإجراء التالي</button>:null}
        {item.ownerActorId?<button type="button" className="button button-secondary" disabled={busy} onClick={()=>choose(item,"ACTION_REQUIRED")}>يتطلب إجراءً</button>:null}
        {item.ownerActorId?<button type="button" className="button button-secondary" disabled={busy} onClick={()=>choose(item,"RESOLVE")}>توثيق الحل</button>:null}
       </div>:null}
     <OperatorCaseAudit orderId={orderId} caseId={item.id} openedAt={item.openedAt} updatedAt={item.updatedAt}/>
   </div>)}
   {nextCursor?<button type="button" className="button button-secondary" disabled={busy||loading} onClick={()=>void more()}>المزيد من الحالات</button>:null}
   {selected?<div className="order-detail-panel">
     <h3>{action==="CLAIM"?"استلام المسؤولية":action==="RESOLVE"?"توثيق معالجة التعثر":"تسجيل الإجراء القادم"}</h3>
     {action!=="CLAIM"?<textarea className="input" rows={2} maxLength={action==="RESOLVE"?1000:500} value={note}
       onChange={event=>{setNote(event.target.value);attempt.current="";}}
       placeholder="ما الذي اتُّخذ أو يجب اتخاذه؟"/>:null}
     <div className="action-row">
       <button type="button" className="button button-primary" disabled={busy} onClick={()=>void submit("TRANSITION",selected)}>حفظ</button>
       <button type="button" className="button button-secondary" disabled={busy} onClick={()=>setSelected(null)}>رجوع</button>
     </div>
   </div>:null}
   {expand?<div className="order-detail-panel">
     <label htmlFor="ops-case-reason">سبب التعثر</label>
     <select id="ops-case-reason" className="input" value={reason} onChange={e=>{setReason(e.target.value);attempt.current="";}}>
       {reasons.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
     </select>
     <label htmlFor="ops-case-priority">الأولوية</label>
     <select id="ops-case-priority" className="input" value={priority} onChange={e=>{setPriority(e.target.value);attempt.current="";}}>
       <option value="NORMAL">عادية</option><option value="URGENT">عاجلة</option>
     </select>
     <label htmlFor="ops-case-next">الإجراء التالي المطلوب</label>
     <textarea id="ops-case-next" className="input" rows={2} maxLength={500} value={nextAction}
       onChange={e=>{setNextAction(e.target.value);attempt.current="";}}/>
     <button type="button" className="button button-primary" disabled={busy||nextAction.trim().length<12}
       onClick={()=>void submit("OPEN")}>تسجيل الحالة</button>
   </div>:null}
   {notice?<p role="status">{notice}</p>:null}
   {error?<p role="alert">{error}</p>:null}
 </section>;
}
