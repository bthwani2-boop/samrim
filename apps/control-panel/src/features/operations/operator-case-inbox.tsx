"use client";

import { Alert, Button, Empty, Flex, Listy, Select, Spin, Tag, Typography } from "antd";
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
 return (
   <section className="order-detail-panel ops-case-queue" aria-labelledby="ops-case-inbox-title">
     <Flex vertical gap="middle">
       <Flex align="center" justify="space-between" gap="middle" wrap>
         <div>
           <h2 id="ops-case-inbox-title">قائمة حالات التعثر</h2>
           <Typography.Text type="secondary">
             {items.length} حالة ضمن السجلات المحمّلة · {items.filter(item=>!item.ownerActorId).length} دون مسؤول{cursor?" · توجد صفحة تالية":""}
           </Typography.Text>
         </div>
         <Flex align="center" gap="small" wrap>
           <label htmlFor="ops-case-scope">المسؤولية</label>
           <Select<Scope>
             id="ops-case-scope"
             aria-label="تصفية حالات التعثر حسب المسؤولية"
             value={scope}
             disabled={busy}
             onChange={setScope}
             style={{ minWidth: 168 }}
             options={[
               { value: "all", label: "الحالات المفتوحة" },
               { value: "unassigned", label: "دون مسؤول" },
               { value: "mine", label: "مسندة إليّ" },
             ]}
           />
         </Flex>
       </Flex>
       {loading&&items.length===0?(
         <Flex align="center" gap="small" role="status">
           <Spin size="small"/>
           <Typography.Text type="secondary">جارٍ قراءة التعثر…</Typography.Text>
         </Flex>
       ):null}
       {error?(
         <Alert
           type="warning"
           showIcon
           message={error}
           action={<Button disabled={loading} onClick={()=>void reload()}>إعادة القراءة</Button>}
         />
       ):null}
       {!loading&&!error&&items.length===0?<Empty description="لا توجد حالات بهذا التصنيف."/>:null}
       {items.length>0?(
         <Listy<Case>
           items={[...items]}
           rowKey="id"
           itemRender={(item)=>(
             <Flex align="center" justify="space-between" gap="middle" wrap data-testid="ops-case-item">
               <Flex vertical gap="small" flex="1" style={{ minWidth: 200, overflowWrap: "anywhere" }}>
                 <Flex align="center" gap="small" wrap>
                   {item.priority==="URGENT"?<Tag color="red">عاجل</Tag>:null}
                   <Typography.Text strong>
                     {labels[item.reason]??"تعثر"} · {item.state==="ACTION_REQUIRED"?"يتطلب إجراءً":item.state==="IN_PROGRESS"?"قيد المعالجة":"ينتظر الاستلام"}
                   </Typography.Text>
                 </Flex>
                 <Typography.Text>{item.nextAction}</Typography.Text>
                 <Typography.Text type="secondary">
                   طلب <bdi dir="ltr">{item.orderId.slice(-8)}</bdi> · {item.ownerActorId?"المسؤول: "+item.ownerActorId:"دون مسؤول"}
                   {clock!==null?" · "+formatOperatorCaseAge(item.openedAt,clock):""}
                 </Typography.Text>
               </Flex>
               <Button onClick={()=>onOpenOrder(item.orderId)} aria-label={"فتح الحالة للطلب "+item.orderId}>فتح الحالة</Button>
             </Flex>
           )}
         />
       ):null}
       {cursor?(
         <Button block loading={busy} disabled={loading} onClick={()=>void more()}>
           المزيد من حالات التعثر
         </Button>
       ):null}
     </Flex>
   </section>
 );
}
