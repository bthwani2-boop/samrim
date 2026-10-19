"use client";
import type { PartnerStoreOperationalAvailabilityResponse, StoreFulfillmentMode, StoreOperationalAvailability, StoreOperationalAvailabilityRequest, StoreScheduleWindow } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "../partners/partner-error-message";

const days = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
const choices: readonly StoreFulfillmentMode[] = ["BTHWANI_CAPTAIN","PARTNER_CAPTAIN","CUSTOMER_PICKUP"];
const labels: Record<string,string> = {
  BTHWANI_CAPTAIN:"توصيل بثواني", PARTNER_CAPTAIN:"توصيل المتجر", CUSTOMER_PICKUP:"استلام من المتجر",
};
const clock = (n:number) => n === 1440 ? "00:00" : `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
const minutes = (time:string, end=false) => time === "00:00" && end ? 1440 : Number(time.slice(0,2))*60+Number(time.slice(3));
const ordered = (rows:readonly StoreScheduleWindow[]) => [...rows].sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.opensAtMinute-b.opensAtMinute);
function validWeeklyWindows(rows: readonly StoreScheduleWindow[]): boolean {
  if (rows.length < 1 || rows.length > 28) return false;
  const values = ordered(rows);
  return values.every((row,index) =>
    Number.isInteger(row.dayOfWeek) && row.dayOfWeek>=0 && row.dayOfWeek<=6 &&
    Number.isInteger(row.opensAtMinute) && row.opensAtMinute>=0 && row.opensAtMinute<1440 &&
    Number.isInteger(row.closesAtMinute) && row.closesAtMinute>row.opensAtMinute && row.closesAtMinute<=1440 &&
    (index===0 || values[index-1]!.dayOfWeek!==row.dayOfWeek || values[index-1]!.closesAtMinute<=row.opensAtMinute));
}
function asDraft(item: StoreOperationalAvailability): StoreOperationalAvailabilityRequest {
  return { scheduleMode:item.scheduleMode, weeklySchedule:[...item.weeklySchedule], paused:item.paused,
    pauseReason:item.paused ? item.pauseReason ?? "" : null, pauseUntil:item.paused ? item.pauseUntil ?? null : null,
    preparationMinutes:item.preparationMinutes ?? null, unavailableFulfillmentModes:[...item.unavailableFulfillmentModes],
    expectedVersion:item.version };
}
function compatible(a:StoreOperationalAvailabilityRequest,b:StoreOperationalAvailability) {
  return a.scheduleMode===b.scheduleMode && a.paused===b.paused &&
    (a.pauseReason??null)===(b.pauseReason??null) &&
    (a.preparationMinutes??null)===(b.preparationMinutes??null) &&
    JSON.stringify(ordered(a.weeklySchedule))===JSON.stringify(ordered(b.weeklySchedule)) &&
    [...a.unavailableFulfillmentModes].sort((a, b) => a.localeCompare(b)).join(",")===[...b.unavailableFulfillmentModes].sort((a, b) => a.localeCompare(b)).join(",");
}
export function StoreAvailabilityControls({storeId,enabledModes}:Readonly<{storeId:string;enabledModes:ReadonlyArray<StoreFulfillmentMode>}>) {
  const [source,setSource] = useState<PartnerStoreOperationalAvailabilityResponse|null>(null);
  const [draft,setDraft] = useState<StoreOperationalAvailabilityRequest|null>(null);
  const [editing,setEditing] = useState(false);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const endpoint = `/api/stores/${encodeURIComponent(storeId)}/operational-availability`;
  const read = useCallback(async(signal?:AbortSignal) => {
    const response = await fetch(endpoint,{cache:"no-store",signal:signal??null});
    if(!response.ok) throw new Error(await partnerErrorMessage(response));
    const data=await response.json() as PartnerStoreOperationalAvailabilityResponse;
    if(data.availability?.storeId!==storeId || !Number.isInteger(data.availability.version)
      || !Array.isArray(data.availability.weeklySchedule)) throw new Error("استجابة أوقات تشغيل المتجر غير صالحة.");
    return data;
  },[endpoint,storeId]);

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError("");setSource(null);setDraft(null);setEditing(false);
    void read(controller.signal).then(value=>{
      if(!controller.signal.aborted){setSource(value);setDraft(asDraft(value.availability));}
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"تعذرت قراءة الأوقات.");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[read]);
  const patch=(change:Partial<StoreOperationalAvailabilityRequest>)=>setDraft(old=>old?{...old,...change}:null);
  const setWindow=(index:number,change:Partial<StoreScheduleWindow>)=>setDraft(old=>old?{
    ...old,weeklySchedule:old.weeklySchedule.map((w,i)=>i===index?{...w,...change}:w)
  }:null);
  async function save(){
    if(!draft || !source || saving) return;
    if(draft.scheduleMode==="WEEKLY" && !validWeeklyWindows(draft.weeklySchedule)) {setError("صحح ساعات العمل: يجب أن تكون كل فترة صالحة وبدون تداخل.");return;}
    if(draft.paused && (draft.pauseReason??"").trim().length<2){setError("اكتب سبب الإيقاف المؤقت.");return;}
    setSaving(true);setError("");setNotice("");
    try{
      const payload={...draft,weeklySchedule:ordered(draft.weeklySchedule)};
      const response=await fetch(endpoint,{
        method:"PATCH",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),"X-Correlation-ID":crypto.randomUUID()},
        body:JSON.stringify(payload),
      });
      const failure=response.ok?"":await partnerErrorMessage(response);
      const current=await read();
      setSource(current);setDraft(asDraft(current.availability));
      if(!response.ok || !compatible(payload,current.availability)){
        throw new Error(failure||"لم تتطابق حالة التشغيل مع قراءة النظام. راجعها قبل تكرار العملية.");
      }
      setEditing(false);setNotice("حُفظت أوقات التشغيل وتأكد تطبيقها على أهلية استقبال الطلبات.");
    }catch(cause){setError(cause instanceof Error?cause.message:"تعذر تأكيد حفظ الأوقات.");}
    finally{setSaving(false);}
  }
  const availability=source?.availability;
  return <section className="store-availability-editor" aria-label="إدارة تشغيل المتجر وأوقاته">
    <div className="store-availability-topline">
      <div><strong>التشغيل الفعلي</strong><small>المنطقة الزمنية: صنعاء (Asia/Aden)</small></div>
      {availability&&!editing?<button type="button" className="button button-secondary" onClick={()=>{setEditing(true);setNotice("");}}>تعديل الأوقات والتشغيل</button>:null}
    </div>
    {loading?<p role="status">جارٍ قراءة حالة التشغيل…</p>:null}
    {error?<div role="alert" className="store-control-error">{error} <button type="button" onClick={()=>{setError("");setLoading(true);void read().then(v=>{setSource(v);setDraft(asDraft(v.availability));}).catch(()=>setError("تعذرت إعادة القراءة.")).finally(()=>setLoading(false));}}>إعادة القراءة</button></div>:null}
    {notice?<p role="status" className="store-control-success">{notice}</p>:null}
    {availability&&!editing?<>
      <div className="store-availability-states">
        <span data-tone={availability.paused?"warning":"success"}>{availability.paused?"الطلبات متوقفة مؤقتًا":"استقبال الطلبات متاح حسب الجدول"}</span>
        <span>{availability.scheduleMode==="ALWAYS_OPEN"?"على مدار الساعة":"جدول أسبوعي"}</span>
        <span>{availability.preparationMinutes ? `${availability.preparationMinutes} دقيقة للتحضير` : "مدة التحضير غير محددة"}</span>
      </div>
      {availability.scheduleMode==="WEEKLY" ? <div className="store-hours-summary">
        {ordered(availability.weeklySchedule).map((row)=><div key={`${row.dayOfWeek}-${row.opensAtMinute}-${row.closesAtMinute}`}><span>{days[row.dayOfWeek]}</span><bdi dir="ltr">{clock(row.opensAtMinute)} – {clock(row.closesAtMinute)}</bdi></div>)}
      </div>:null}
      {availability.paused&&availability.pauseReason?<p className="store-control-error">{availability.pauseReason}</p>:null}
      <div className="store-availability-modes">{source?.orderabilityByMode.map(item=>
        <span key={item.fulfillmentMode} data-tone={item.state==="OPEN_FOR_ORDERS"?"success":"warning"}>
          {labels[item.fulfillmentMode]??item.fulfillmentMode}: {item.state==="OPEN_FOR_ORDERS"?"متاح":"غير متاح حاليًا"}
        </span>)}</div>
    </>:null}

    {editing&&draft&&availability?<div className="store-availability-form">
      <fieldset disabled={saving}>
        <legend>أوقات استقبال الطلبات</legend>
        <div className="store-availability-schedule-mode">
          <label><input type="radio" name="store-schedule-mode" checked={draft.scheduleMode==="ALWAYS_OPEN"}
            onChange={()=>patch({scheduleMode:"ALWAYS_OPEN",weeklySchedule:[]})}/> على مدار الساعة</label>
          <label><input type="radio" name="store-schedule-mode" checked={draft.scheduleMode==="WEEKLY"}
            onChange={()=>patch({scheduleMode:"WEEKLY"})}/> حسب أيام وساعات محددة</label>
        </div>
        {draft.scheduleMode==="WEEKLY"?<div className="store-weekly-editor">
          {days.map((day,dayOfWeek)=><div key={day} className="store-weekly-day">
            <div className="store-weekly-day-heading"><strong>{day}</strong>
              <button type="button" disabled={draft.weeklySchedule.length>=28} onClick={()=>patch({weeklySchedule:[
                ...draft.weeklySchedule,{dayOfWeek,opensAtMinute:540,closesAtMinute:1020}]})}>+ إضافة فترة</button></div>
            {draft.weeklySchedule.map((item,index)=>item.dayOfWeek===dayOfWeek?<div key={`${item.dayOfWeek}-${item.opensAtMinute}-${item.closesAtMinute}`} className="store-weekly-window">
              <label>من <input aria-label={`بداية عمل ${day} الفترة ${index+1}`} type="time" value={clock(item.opensAtMinute)}
                onChange={event=>setWindow(index,{opensAtMinute:minutes(event.target.value)})}/></label>
              <label>إلى <input aria-label={`نهاية عمل ${day} الفترة ${index+1}`} type="time" value={clock(item.closesAtMinute)}
                onChange={event=>setWindow(index,{closesAtMinute:minutes(event.target.value,true)})}/></label>
              <button type="button" aria-label={`حذف فترة ${day} رقم ${index+1}`}
                onClick={()=>patch({weeklySchedule:draft.weeklySchedule.filter((_,i)=>i!==index)})}>حذف</button>
            </div>:null)}
            {!draft.weeklySchedule.some(item=>item.dayOfWeek===dayOfWeek)?<span>مغلق</span>:null}
          </div>)}
          {!validWeeklyWindows(draft.weeklySchedule) ? <p role="alert" className="store-control-error">يجب إضافة فترة صالحة واحدة على الأقل دون تداخل في اليوم نفسه.</p> : null}
          <p>عند الحاجة إلى العمل بعد منتصف الليل، أضف فترة مستقلة في اليوم التالي.</p>
        </div>:null}
      </fieldset>
      <fieldset disabled={saving}><legend>التحكم التشغيلي</legend>
        <label className="store-availability-toggle"><input type="checkbox" checked={draft.paused}
          onChange={event=>patch({paused:event.target.checked,pauseReason:event.target.checked?"":null,pauseUntil:null})}/> إيقاف استقبال الطلبات مؤقتًا</label>
        {draft.paused?<label>سبب الإيقاف<input type="text" value={draft.pauseReason??""} maxLength={500}
          onChange={event=>patch({pauseReason:event.target.value})} placeholder="سبب واضح للمشغّلين والشريك"/></label>:null}
        <label>مدة تجهيز الطلب (دقيقة)
          <input type="number" min={1} max={1440} value={draft.preparationMinutes??""} placeholder="غير محددة"
            onChange={event=>patch({preparationMinutes:event.target.value?Number(event.target.value):null})}/></label>
        <div className="store-availability-mode-toggles"><strong>تعطيل مؤقت لطريقة تنفيذ محددة</strong>
          {choices.map(value=><label key={value}><input type="checkbox" disabled={!enabledModes.includes(value)} checked={draft.unavailableFulfillmentModes.includes(value)}
            onChange={()=>patch({unavailableFulfillmentModes:draft.unavailableFulfillmentModes.includes(value)
              ? draft.unavailableFulfillmentModes.filter(item=>item!==value)
              : [...draft.unavailableFulfillmentModes,value]})}/>{labels[value]}{!enabledModes.includes(value)?" · غير مفعّل في المتجر":""}</label>)}
        </div>
      </fieldset>
      <div className="store-control-actions">
        <button type="button" className="button button-primary" disabled={saving||compatible(draft,availability)||(draft.scheduleMode==="WEEKLY"&&!validWeeklyWindows(draft.weeklySchedule))}
          onClick={()=>void save()}>{saving?"جارٍ الحفظ…":"حفظ وتطبيق"}</button>
        <button type="button" className="button button-secondary" disabled={saving}
          onClick={()=>{setDraft(asDraft(availability));setEditing(false);setError("");}}>إلغاء</button>
      </div>
    </div>:null}
  </section>;
}
