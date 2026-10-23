"use client";

import { useCallback,useEffect,useRef,useState } from "react";

type Case = Readonly<{
 id:number;orderId:string;reason:string;state:string;priority:string;
 ownerActorId?:string;nextAction:string;openedAt:string;
}>;
type Page = Readonly<{items:ReadonlyArray<Case>;nextCursor:string}>;
type Scope = "all"|"mine"|"unassigned";
const labels:Readonly<Record<string,string>>={
 PARTNER_DELAY:"تأخر الشريك",DISPATCH_UNAVAILABLE:"تعذر توزيع الطلب",
 DELIVERY_BLOCKED:"تعثر التسليم",CUSTOMER_CONTACT:"متابعة العميل",
 PAYMENT_EXCEPTION:"استثناء مالي",OTHER:"متابعة تشغيلية"
};

export function OperatorCaseInbox({onOpenOrder,refreshVersion}:Readonly<{
 onOpenOrder:(orderId:string)=>void;refreshVersion:number;
}>) {
 const [scope,setScope]=useState<Scope>("all");
 const [items,setItems]=useState<ReadonlyArray<Case>>([]);
 const [cursor,setCursor]=useState("");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const generation=useRef(0);
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
   setItems([]);setCursor("");setError("");
   void reload();
   return ()=>{generation.current+=1;};
 },[reload,refreshVersion]);
 useEffect(()=>{
   const interval=window.setInterval(()=>{if(!document.hidden&&!busy)void reload();},60_000);
   return ()=>window.clearInterval(interval);
 },[reload,busy]);
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
 if(!loading&&!error&&items.length===0&&scope==="all")return null;
 return <section className="order-detail-panel" aria-labelledby="ops-case-inbox-title">
   <div className="action-row">
     <h2 id="ops-case-inbox-title">التعثر الذي يحتاج متابعة</h2>
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
     {items.map(item=><li key={item.id}>
       <div>
         <strong>{item.priority==="URGENT"?"عاجل · ":""}{labels[item.reason]??"تعثر"} · {item.state==="ACTION_REQUIRED"?"يتطلب إجراءً":item.state==="IN_PROGRESS"?"قيد المعالجة":"ينتظر الاستلام"}</strong>
         <p>{item.nextAction}</p>
         <p className="muted">طلب <span dir="ltr">{item.orderId.slice(-8)}</span> · {item.ownerActorId?"المسؤول: "+item.ownerActorId:"دون مسؤول"}</p>
       </div>
       <button type="button" className="button button-secondary" onClick={()=>onOpenOrder(item.orderId)}>فتح الحالة</button>
     </li>)}
   </ul>:null}
   {cursor?<button type="button" className="button button-secondary" disabled={loading||busy} onClick={()=>void more()}>
     {busy?"جارٍ العرض…":"المزيد من حالات التعثر"}
   </button>:null}
 </section>;
}
