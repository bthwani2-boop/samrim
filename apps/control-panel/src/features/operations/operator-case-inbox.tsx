"use client";

import { useCallback,useEffect,useRef,useState } from "react";
import { formatOperatorCaseAge } from "./operator-case-age";

type Case = Readonly<{
 id:number;orderId:string;reason:string;state:string;priority:string;
 ownerActorId?:string;nextAction:string;openedAt:string;
}>;
type Page = Readonly<{items:ReadonlyArray<Case>;nextCursor:string}>;
type Scope = "all"|"mine"|"unassigned";
const labels:Readonly<Record<string,string>>={
 PARTNER_DELAY:"تأخر الشريك",DISPATCH_UNAVAILABLE:"تعذر توزيع الطلب",
 DELIVERY_BLOCKED:"تعثر التسليم",CAPTAIN_LOCATION_LOST:"موقع المهمة مفقود",CUSTOMER_CONTACT:"متابعة العميل",
 PAYMENT_EXCEPTION:"استثناء مالي",OTHER:"متابعة تشغيلية"
};

export function OperatorCaseInbox({onOpenOrder,refreshVersion,active=true}:Readonly<{
 onOpenOrder:(orderId:string)=>void;refreshVersion:number;active?:boolean;
}>) {
 const [scope,setScope]=useState<Scope>("all");
 const [items,setItems]=useState<ReadonlyArray<Case>>([]);
 const [cursor,setCursor]=useState("");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [clock,setClock]=useState<number|null>(null);
 const generation=useRef(0);
 useEffect(()=>{
   setClock(Date.now());
   const handle=window.setInterval(()=>setClock(Date.now()),60_000);
   return ()=>window.clearInterval(handle);
 },[]);
 const read=useCallback(async(next=""):Promise<Page>=>{
   const params=new URLSearchParams({limit:"15",scope});
   if(next)params.set("cursor",next);
   const response=await fetch(`/api/operations/cases?${params.toString()}`,
     {cache:"no-store",signal:AbortSignal.timeout(12_000)});
   if(!response.ok)throw new Error("تعذرت قراءة حالات التعثر.");
   const body=await response.json() as Partial<Page>;
   if(!Array.isArray(body.items)||typeof body.nextCursor!=="string"||
     !body.items.every(item=>item&&typeof item.orderId==="string"&&typeof item.id==="number"&&item.id>0)){
     throw new Error("قائمة التعثر غير صالحة.");
   }
   return body as Page;
 },[scope]);
 const reload=useCallback(async()=>{
   const current=++generation.current;
   setLoading(true);
   try{
     const result=await read();
     if(current!==generation.current)return;
     setItems(result.items);setCursor(result.nextCursor);setError("");
   }catch{
     if(current===generation.current){
       setItems([]);setCursor("");setError("تعذرت قراءة حالات التعثر الحالية.");
     }
   }finally{if(current===generation.current)setLoading(false);}
 },[read]);
 useEffect(()=>{
   if (!active || refreshVersion < 0) return;
   setItems([]);setCursor("");setError("");
   void reload();
   return ()=>{generation.current+=1;};
 },[reload,refreshVersion,active]);
 useEffect(()=>{
   if (!active) return;
   const interval=window.setInterval(()=>{if(!document.hidden&&!busy)void reload();},60_000);
   return ()=>window.clearInterval(interval);
 },[reload,busy,active]);
 async function more(){
   if(!cursor||busy||loading)return;
   const current=generation.current;
   setBusy(true);
   try{
     const page=await read(cursor);
     if(current===generation.current){
       setItems(previous=>{
         const seen=new Set(previous.map(item=>item.id));
         return [...previous,...page.items.filter(item=>!seen.has(item.id))];
       });
       setCursor(page.nextCursor);setError("");
     }
   }catch{if(current===generation.current)setError("تعذر تحميل المزيد من الحالات.");}
   finally{setBusy(false);}
 }
 return <section className="order-detail-panel ops-case-queue" aria-labelledby="ops-case-inbox-title">
   <div className="action-row">
     <div><h2 id="ops-case-inbox-title">قائمة حالات التعثر</h2><p className="ops-case-count">{items.length} حالة ضمن السجلات المحمّلة · {items.filter(item=>!item.ownerActorId).length} دون مسؤول{cursor?" · توجد صفحة تالية":""}</p></div>
     <label>المسؤولية
       <select className="input" value={scope} disabled={busy} onChange={e=>setScope(e.target.value as Scope)}>
         <option value="all">الحالات المفتوحة</option>
         <option value="unassigned">دون مسؤول</option>
         <option value="mine">مسندة إليّ</option>
       </select>
     </label>
   </div>
   {loading&&items.length===0?<p className="muted" role="status">جارٍ قراءة التعثر…</p>:null}
   {error?<div className="managed-status managed-status-warning" role="alert">{error}
     <button type="button" className="button button-secondary" disabled={loading} onClick={()=>void reload()}>إعادة القراءة</button>
   </div>:null}
   {!loading&&!error&&items.length===0?<p className="muted">لا توجد حالات بهذا التصنيف.</p>:null}
   {items.length>0?<ul className="order-detail-list">
     {items.map(item=><li key={item.id} className={"ops-case-row" + (item.priority==="URGENT"?" is-urgent":"")}>
       <div className="ops-case-information">
         <strong>{item.priority==="URGENT"?"عاجل · ":""}{labels[item.reason]??"تعثر"} · {item.state==="ACTION_REQUIRED"?"يتطلب إجراءً":item.state==="IN_PROGRESS"?"قيد المعالجة":"ينتظر الاستلام"}</strong>
         <p>{item.nextAction}</p>
         <p className="muted">طلب <span dir="ltr">{item.orderId.slice(-8)}</span> · {item.ownerActorId?"المسؤول: "+item.ownerActorId:"دون مسؤول"}{clock!==null?" · "+formatOperatorCaseAge(item.openedAt,clock):""}</p>
       </div>
       <button type="button" className="button button-secondary" onClick={()=>onOpenOrder(item.orderId)}>فتح الحالة</button>
     </li>)}
   </ul>:null}
   {cursor?<button type="button" className="button button-secondary" disabled={loading||busy} onClick={()=>void more()}>
     {busy?"جارٍ العرض…":"المزيد من حالات التعثر"}
   </button>:null}
 </section>;
}
