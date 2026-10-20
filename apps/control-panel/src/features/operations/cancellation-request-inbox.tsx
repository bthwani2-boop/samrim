"use client";
import { useCallback, useEffect, useState } from "react";

type PendingCancellation = Readonly<{
  id:string; orderId:string; clientActorId:string; reason:string;
  state:"PENDING"|"APPROVED"|"DECLINED"; createdAt:string;
}>;
export function CancellationRequestInbox({onOpenOrder, refreshVersion}:Readonly<{onOpenOrder:(id:string)=>void; refreshVersion:number}>) {
  const [items,setItems]=useState<readonly PendingCancellation[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [declining,setDeclining]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const response=await fetch("/api/operations/cancellation-requests",{cache:"no-store"});
      if(!response.ok) throw new Error("تعذر قراءة طلبات الإلغاء");
      const body=await response.json() as {requests?:PendingCancellation[]};
      if(!Array.isArray(body.requests)) throw new Error("بيانات طلبات الإلغاء غير صالحة");
      setItems(body.requests.filter(item=>item.state==="PENDING"));
    }catch(cause){setError(cause instanceof Error?cause.message:"تعذر عرض طلبات الإلغاء");setItems([])}
    finally {setLoading(false)}
  },[]);
  useEffect(()=>{void load()},[load,refreshVersion]);
  async function decline(id:string) {
    if(busy||Array.from(reason.trim()).length<12)return;
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/operations/cancellation-requests/${encodeURIComponent(id)}/decline`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason.trim()}),
      });
      if(!response.ok) throw new Error("تعذر تسجيل رفض الطلب، حدّث القائمة أولًا");
      setDeclining("");setReason("");await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"تعذّر تنفيذ القرار")}
    finally{setBusy(false)}
  }
  return <section aria-labelledby="ops-cancellation-inbox-title" className="order-detail-panel">
    <div className="action-row">
      <h2 id="ops-cancellation-inbox-title">طلبات الإلغاء من العملاء ({items.length})</h2>
      <button type="button" className="button button-secondary" onClick={()=>void load()} disabled={loading||busy}>تحديث الطلبات</button>
    </div>
    <p className="muted">الطلب لا يتوقف حتى تراجعه العمليات وتتخذ قرارًا. الإلغاء لا يضيف تعويضًا تلقائيًا للمحفظة.</p>
    {error?<p role="alert">{error}</p>:null}
    {!items.length&&!loading&&!error?<p className="muted">لا توجد طلبات إلغاء بانتظار المراجعة.</p>:null}
    {items.length?<ul className="order-detail-list">{items.map(item=><li key={item.id}>
      <div><strong>طلب إلغاء</strong><p>{item.reason}</p><small>رقم الطلب: {item.orderId}</small></div>
      <div className="action-row">
        <button type="button" className="button button-primary" onClick={()=>onOpenOrder(item.orderId)}>مراجعة الطلب والإلغاء</button>
        <button type="button" className="button button-secondary" onClick={()=>{setDeclining(item.id);setReason("")}}>رفض الطلب</button>
      </div>
      {declining===item.id?<div>
        <label htmlFor="decline-cancellation-reason">سبب الرفض للعميل</label>
        <textarea id="decline-cancellation-reason" value={reason} maxLength={500} rows={2}
          onChange={event=>setReason(event.target.value)} />
        <div className="action-row">
          <button type="button" className="button button-primary" disabled={busy||Array.from(reason.trim()).length<12} onClick={()=>void decline(item.id)}>تسجيل الرفض</button>
          <button type="button" className="button button-secondary" onClick={()=>setDeclining("")}>رجوع</button>
        </div>
      </div>:null}
    </li>)}</ul>:null}
  </section>;
}
