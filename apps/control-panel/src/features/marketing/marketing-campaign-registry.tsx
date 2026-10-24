"use client";

import type { MarketingCampaign, MarketingCampaignPage } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";

const objectives = [
  { value: "ACQUISITION", label: "اكتساب عملاء" },
  { value: "CONVERSION", label: "زيادة الطلبات" },
  { value: "RETENTION", label: "الاحتفاظ بالعملاء" },
  { value: "REACTIVATION", label: "استعادة العملاء" },
] as const;
const states = [
  { value: "", label: "كل الحملات" },
  { value: "DRAFT", label: "مسودات" },
  { value: "PUBLISHED", label: "نشطة" },
  { value: "PAUSED", label: "موقوفة" },
  { value: "ENDED", label: "منتهية" },
  { value: "ARCHIVED", label: "مؤرشفة" },
] as const;
const transitions: Record<string, ReadonlyArray<{ state: "PUBLISHED"|"PAUSED"|"ENDED"|"ARCHIVED"; label: string }>> = {
  DRAFT: [{ state: "PUBLISHED", label: "نشر" }, { state: "ARCHIVED", label: "أرشفة" }],
  PUBLISHED: [{ state: "PAUSED", label: "إيقاف" }, { state: "ENDED", label: "إنهاء" }],
  PAUSED: [{ state: "PUBLISHED", label: "استئناف" }, { state: "ENDED", label: "إنهاء" }],
  ENDED: [{ state: "ARCHIVED", label: "أرشفة" }],
};
const fmt=(value:number)=>value.toLocaleString("ar-YE");

export function MarketingCampaignRegistry() {
  const [filter,setFilter]=useState("");
  const [rows,setRows]=useState<ReadonlyArray<MarketingCampaign>>([]);
  const [cursor,setCursor]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [nameAr,setNameAr]=useState("");
  const [objective,setObjective]=useState<(typeof objectives)[number]["value"]>("CONVERSION");
  const [budget,setBudget]=useState("");
  const [creating,setCreating]=useState(false);
  const key=useRef(crypto.randomUUID());
  const read=useCallback(async (nextCursor="",append=false)=>{
    const query=new URLSearchParams();
    if(filter)query.set("state",filter);
    if(nextCursor)query.set("cursor",nextCursor);
    const response=await fetch("/api/marketing/campaigns?"+query.toString(),{cache:"no-store"});
    const data=await response.json() as MarketingCampaignPage & {error?:{message?:string}};
    if(!response.ok || !Array.isArray(data.items))throw new Error(data.error?.message ?? "تعذرت قراءة الحملات");
    setRows(old=>append?[...old,...data.items]:data.items);
    setCursor(data.nextCursor ?? "");
  },[filter]);
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      setBusy(true);setMessage("");
      try{
        const query=filter?"?state="+encodeURIComponent(filter):"";
        const response=await fetch("/api/marketing/campaigns"+query,{cache:"no-store",signal:controller.signal});
        const data=await response.json() as MarketingCampaignPage & {error?:{message?:string}};
        if(!response.ok || !Array.isArray(data.items))throw new Error(data.error?.message ?? "تعذرت قراءة الحملات");
        if(!controller.signal.aborted){setRows(data.items);setCursor(data.nextCursor ?? "");}
      }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"تعذرت قراءة الحملات");}
      finally{if(!controller.signal.aborted)setBusy(false);}
    })();
    return ()=>controller.abort();
  },[filter]);
  const create=async(event:React.FormEvent)=>{
    event.preventDefault();
    const amount=Number(budget);
    if(!nameAr.trim() || !Number.isSafeInteger(amount) || amount<=0){setMessage("اسم الحملة وميزانية صحيحة مطلوبان");return;}
    setCreating(true);setMessage("");
    try{
      const response=await fetch("/api/marketing/campaigns",{
        method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key.current},
        body:JSON.stringify({nameAr:nameAr.trim(),objective,budgetLimitMinor:amount}),
      });
      const data=await response.json() as {campaign?:MarketingCampaign;error?:{message?:string}};
      if(!response.ok || !data.campaign)throw new Error(data.error?.message ?? "تعذر حفظ الحملة");
      setNameAr("");setBudget("");key.current=crypto.randomUUID();
      await read();setMessage("حُفظت المسودة؛ اربط العرض والمحتوى قبل النشر");
    }catch(error){setMessage(error instanceof Error?error.message:"تعذر الحفظ");}
    finally{setCreating(false);}
  };
  const mutate=async(campaign:MarketingCampaign,state:"PUBLISHED"|"PAUSED"|"ENDED"|"ARCHIVED")=>{
    if(state==="ENDED" && !window.confirm("إنهاء الحملة نهائيًا؟"))return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/marketing/campaigns/"+encodeURIComponent(campaign.id)+"/state",{
        method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),"X-Expected-Version":String(campaign.version)},
        body:JSON.stringify({state}),
      });
      const data=await response.json() as {error?:{message?:string}};
      if(!response.ok)throw new Error(data.error?.message ?? "تعذر تغيير حالة الحملة");
      await read();
    }catch(error){setMessage(error instanceof Error?error.message:"تعذر إجراء الحملة");}
    finally{setBusy(false);}
  };
  return <section className="work-stack" aria-label="سجل الحملات الموحد">
    <div className="access-card">
      <div className="section-heading"><h2>الحملات الموحدة</h2><p className="muted">ميزانية الحملة وسجل الحالات من DSH</p></div>
      <details>
        <summary>إنشاء حملة</summary>
        <form className="work-stack" onSubmit={create}>
          <label className="field-label">اسم الحملة<input required maxLength={160} value={nameAr} onChange={e=>{setNameAr(e.target.value);key.current=crypto.randomUUID();}} /></label>
          <label className="field-label">الهدف<select value={objective} onChange={e=>{setObjective(e.target.value as typeof objective);key.current=crypto.randomUUID();}}>{objectives.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className="field-label">الميزانية (وحدة مالية صغرى)<input type="number" min={1} step={1} required value={budget} onChange={e=>{setBudget(e.target.value);key.current=crypto.randomUUID();}} /></label>
          <button className="button button-primary" type="submit" disabled={creating}>{creating?"جارٍ الحفظ...":"حفظ المسودة"}</button>
        </form>
      </details>
    </div>
    <div className="access-card">
      <label className="field-label">الحالة<select value={filter} onChange={e=>setFilter(e.target.value)}>{states.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
      {message?<p role="status">{message}</p>:null}
      {busy?<p role="status">جارٍ التحديث...</p>:null}
      {!busy && rows.length===0?<p className="muted">لا توجد حملات مطابقة. أنشئ مسودة للبدء.</p>:null}
      {rows.map(c=><details key={c.id} className="access-card">
        <summary>{c.nameAr} · {states.find(s=>s.value===c.state)?.label ?? c.state}</summary>
        <dl className="marketing-analytics-breakdown">
          <div><dt>ميزانية الحملة</dt><dd>{fmt(c.budgetLimitMinor)}</dd></div>
          <div><dt>مجموع سقوف العروض</dt><dd>{fmt(c.assignedPromotionBudgetMinor)}</dd></div>
          <div><dt>العروض / المواد</dt><dd>{fmt(c.promotionCount)} / {fmt(c.contentCount)}</dd></div>
          <div><dt>الإصدار</dt><dd>{fmt(c.version)}</dd></div>
        </dl>
        {c.state === "DRAFT" ? <CampaignElementLink campaign={c} onChanged={() => void read()} /> : null}
        <div className="actions-row">{(transitions[c.state]??[]).map(action=><button type="button" className="button button-secondary" key={action.state} disabled={busy} onClick={()=>void mutate(c,action.state)}>{action.label}</button>)}</div>
      </details>)}
      {cursor?<button className="button button-secondary" type="button" disabled={busy} onClick={()=>{setBusy(true);void read(cursor,true).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}}>عرض المزيد</button>:null}
    </div>
  </section>;
}


function CampaignElementLink({ campaign, onChanged }: Readonly<{ campaign: MarketingCampaign; onChanged: () => void }>) {
  const [kind, setKind] = useState<"PROMOTION"|"CONTENT">("PROMOTION");
  const [resourceId, setResourceId] = useState("");
  const [error,setError] = useState("");
  const [pending,setPending] = useState(false);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(!resourceId.trim())return;
    setPending(true);setError("");
    try{
      const response=await fetch("/api/marketing/campaigns/"+encodeURIComponent(campaign.id)+"/elements",{
        method:"POST",
        headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),"X-Expected-Version":String(campaign.version)},
        body:JSON.stringify({kind,resourceId:resourceId.trim()})
      });
      const data=await response.json() as { error?: {message?: string} };
      if(!response.ok)throw new Error(data.error?.message??"تعذر ربط العنصر");
      setResourceId("");onChanged();
    }catch(reason){setError(reason instanceof Error?reason.message:"تعذر ربط العنصر");}
    finally{setPending(false);}
  };
  return <details>
    <summary>ربط عرض أو مادة موجودة</summary>
    <form className="work-stack" onSubmit={submit}>
      <label className="field-label">نوع العنصر<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
        <option value="PROMOTION">عرض خصم</option><option value="CONTENT">مادة تسويقية</option>
      </select></label>
      <label className="field-label">معرّف العنصر<input required maxLength={128} value={resourceId} onChange={e=>setResourceId(e.target.value)} /></label>
      <button className="button button-secondary" type="submit" disabled={pending}>{pending?"جارٍ الربط...":"ربط بالمسودة"}</button>
      {error?<p role="alert">{error}</p>:null}
    </form>
  </details>;
}
