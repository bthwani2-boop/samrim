"use client";
import { Alert, Button, Empty, Flex, Input, Listy, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

type PendingCancellation = Readonly<{
  id:string; orderId:string; clientActorId:string; reason:string;
  state:"PENDING"|"APPROVED"|"DECLINED"; createdAt:string;
}>;
export function CancellationRequestInbox({onOpenOrder, refreshVersion, active=true}:Readonly<{onOpenOrder:(id:string)=>void; refreshVersion:number; active?:boolean}>) {
  const [items,setItems]=useState<readonly PendingCancellation[]>([]);
  const [cursor,setCursor]=useState("");
  const [loading,setLoading]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const [error,setError]=useState("");
  const generation=useRef(0);
  const [declining,setDeclining]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const read=useCallback(async(next="")=>{
    const query=new URLSearchParams({limit:"25"});
    if(next) query.set("cursor",next);
    const response=await fetch("/api/operations/cancellation-requests?"+query.toString(),
      {cache:"no-store",signal:AbortSignal.timeout(12_000)});
    if(!response.ok) throw new Error("تعذر قراءة طلبات الإلغاء");
    const body=await response.json() as {requests?:PendingCancellation[];nextCursor?:string};
    if(!Array.isArray(body.requests)||typeof body.nextCursor!=="string"||
      !body.requests.every(item=>item&&typeof item.id==="string"&&typeof item.orderId==="string"&&item.state==="PENDING")){
      throw new Error("بيانات طلبات الإلغاء غير صالحة");
    }
    return {requests:body.requests,nextCursor:body.nextCursor};
  },[]);
  const load=useCallback(async()=>{
    const current=++generation.current;
    setLoading(true);setError("");
    try {
      const page=await read();
      if(current!==generation.current)return;
      setItems(page.requests);setCursor(page.nextCursor);
    }catch(cause){
      if(current===generation.current){
        setError(cause instanceof Error?cause.message:"تعذر عرض طلبات الإلغاء");
        setItems([]);setCursor("");
      }
    }finally {if(current===generation.current)setLoading(false)}
  },[read]);
  useEffect(() => {
    if (active && refreshVersion >= 0) void load();
    return ()=>{generation.current+=1;};
  }, [load, refreshVersion, active]);
  async function more(){
    if(!cursor||loading||loadingMore||busy)return;
    const current=generation.current;
    setLoadingMore(true);setError("");
    try{
      const page=await read(cursor);
      if(current!==generation.current)return;
      setItems(previous=>{
        const ids=new Set(previous.map(item=>item.id));
        return [...previous,...page.requests.filter(item=>!ids.has(item.id))];
      });
      setCursor(page.nextCursor);
    }catch(cause){
      if(current===generation.current)setError(cause instanceof Error?cause.message:"تعذر تحميل المزيد من الطلبات");
    }finally{setLoadingMore(false)}
  }
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (!document.hidden && !busy) void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load, busy, active]);
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

  return (
    <section aria-labelledby="ops-cancellation-inbox-title" className="order-detail-panel">
      <Flex vertical gap="middle">
        <div>
          <h2 id="ops-cancellation-inbox-title">طلبات الإلغاء من العملاء ({items.length} محمّلة{cursor?" · يوجد المزيد":""})</h2>
          <Typography.Text type="secondary">
            الطلب لا يتوقف حتى تراجعه العمليات وتتخذ قرارًا. الإلغاء لا يضيف تعويضًا تلقائيًا للمحفظة.
          </Typography.Text>
        </div>
        {loading && !items.length ? (
          <Flex align="center" gap="small" role="status">
            <Spin size="small" />
            <Typography.Text type="secondary">جارٍ قراءة طلبات الإلغاء…</Typography.Text>
          </Flex>
        ) : null}
        {error ? (
          <Alert
            type="warning"
            showIcon
            message={error}
            action={<Button disabled={loading || busy} onClick={() => void load()}>إعادة المحاولة</Button>}
          />
        ) : null}
        {!items.length && !loading && !error ? <Empty description="لا توجد طلبات إلغاء بانتظار المراجعة." /> : null}
        {items.length ? (
          <Listy<PendingCancellation>
            rowKey="id"
            items={[...items]}
            itemRender={(item) => (
              <Flex vertical gap="middle" data-testid="ops-cancellation-item">
                <Flex justify="space-between" align="center" gap="middle" wrap>
                  <Flex vertical gap="small" flex="1" style={{ minWidth: 200, overflowWrap: "anywhere" }}>
                    <Typography.Text strong>طلب إلغاء</Typography.Text>
                    <Typography.Text>{item.reason}</Typography.Text>
                    <Typography.Text type="secondary">رقم الطلب: <bdi dir="ltr">{item.orderId}</bdi></Typography.Text>
                  </Flex>
                  <Flex gap="small" wrap>
                    <Button type="primary" onClick={() => onOpenOrder(item.orderId)}>مراجعة الطلب والإلغاء</Button>
                    <Button disabled={busy} onClick={() => { setDeclining(item.id); setReason(""); }}>رفض الطلب</Button>
                  </Flex>
                </Flex>
                {declining === item.id ? (
                  <Flex vertical gap="small">
                    <label htmlFor="decline-cancellation-reason">سبب الرفض للعميل</label>
                    <Input.TextArea
                      id="decline-cancellation-reason"
                      value={reason}
                      maxLength={500}
                      rows={2}
                      showCount
                      aria-label="سبب الرفض للعميل"
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Flex align="center" gap="small" wrap>
                      <Button
                        type="primary"
                        danger
                        loading={busy}
                        disabled={Array.from(reason.trim()).length < 12}
                        onClick={() => void decline(item.id)}
                      >
                        تسجيل الرفض
                      </Button>
                      <Button disabled={busy} onClick={() => setDeclining("")}>رجوع</Button>
                    </Flex>
                  </Flex>
                ) : null}
              </Flex>
            )}
          />
        ) : null}
        {cursor ? (
          <Button block loading={loadingMore} disabled={loading||busy} onClick={()=>void more()}>
            تحميل المزيد من طلبات الإلغاء
          </Button>
        ) : null}
      </Flex>
    </section>
  );
}
