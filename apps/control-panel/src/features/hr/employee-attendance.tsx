"use client";
import { TextArea } from "@bthwani/design-system/web";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { HRAttendanceRecord,HRAttendanceStatus,HRAttendancePage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { RegistryColumnHeader } from "../shared/registry-column-header";

const descriptions:Record<HRAttendanceStatus,string>={present:"حاضر",late:"متأخر وفق مراجعة HR",absent:"غائب (مسجل يدويًا)",leave:"إجازة موثقة يدويًا"};
const pad=(n:number)=>String(n).padStart(2,"0");
const localInputTime=(iso:string)=>{const date=new Date(iso);return dateString(date)+"T"+pad(date.getHours())+":"+pad(date.getMinutes())};
const dateString=(date:Date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export function EmployeeAttendance({employeeId}:{employeeId:string}){
 const [day,setDay]=useState(()=>dateString(new Date()));
 const [items,setItems]=useState<readonly HRAttendanceRecord[]>([]);
 const [rowStatus,setRowStatus]=useState("all");
 const [rowSort,setRowSort]=useState("default");
 const [minimumVersion,setMinimumVersion]=useState("");
 const [status,setStatus]=useState<HRAttendanceStatus>("present");
 const [note,setNote]=useState("");
 const [checkIn,setCheckIn]=useState("");
 const [checkOut,setCheckOut]=useState("");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const retry=useRef<{signature:string;key:string}|null>(null);
 const selected=items.find(x=>x.date===day);
 const visibleRecords=items.filter((item)=>
   (rowStatus==="all"||item.status===rowStatus)
   && (!minimumVersion||item.version>=Number(minimumVersion))
 ).sort((a,b)=>rowSort==="default"?0:(rowSort==="asc"?1:-1)*a.date.localeCompare(b.date));
 const load=useCallback(async()=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
  setLoading(true);setError("");
  const from=new Date(day+"T12:00:00");from.setDate(from.getDate()-30);
  try{
   const qs=new URLSearchParams({from:dateString(from),to:day});
   const response=await identityFetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/attendance?${qs}`);
   if(!response.ok)throw Error("تعذر تحميل سجل الحضور");
   const result=await response.json() as HRAttendancePage;
   setItems(result.items);
  }catch(cause){setError(cause instanceof Error?cause.message:"تعذر قراءة الحضور")}
  finally{setLoading(false)}
 },[day,employeeId]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{
  setStatus(selected?.status??"present");
  setNote(selected?.note??"");
  setCheckIn(selected?.checkInAt?localInputTime(selected.checkInAt):"");
  setCheckOut(selected?.checkOutAt?localInputTime(selected.checkOutAt):"");
  retry.current=null;
 },[selected]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||loading)return;
  const normalizedNote=note.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){setError("اختر تاريخًا صالحًا للتسجيل.");return;}
  if(normalizedNote.length<8||normalizedNote.length>500){setError("اكتب سببًا واضحًا من 8 إلى 500 حرف.");return;}
  if((checkIn==="")!==(checkOut==="")){setError("أدخل وقتَي الدخول والخروج معًا أو اتركهما فارغين");return;}
  let normalizedCheckIn: string|undefined, normalizedCheckOut:string|undefined;
  try{
   if(checkIn&&checkOut){normalizedCheckIn=new Date(checkIn).toISOString();normalizedCheckOut=new Date(checkOut).toISOString();}
  }catch{setError("وقت الدخول أو الخروج غير صالح");return}
  const body={date:day,status,note:normalizedNote,expectedVersion:selected?.version??0,
   ...(normalizedCheckIn?{checkInAt:normalizedCheckIn,checkOutAt:normalizedCheckOut}: {})};
  const signature=JSON.stringify(body);
  if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
  setBusy(true);setError("");setNotice("");
  try{
   const response=await identityFetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/attendance`,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":retry.current.key},
    body:signature,
   });
   if(!response.ok){
    if(response.status===409){retry.current=null;throw Error("تغير السجل أثناء العمل. أعد تحميل التاريخ قبل التصحيح.");}
    throw Error("تعذر حفظ الحضور. يمكن إعادة المحاولة بالمعلومات نفسها.");
   }
   retry.current=null;setNotice("حُفظ التسجيل في HR مع تاريخ تصحيح غير قابل للحذف.");
   await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"تعذر حفظ الحضور")}
  finally{setBusy(false)}
 }
 return <section className="form-section form-section--w620" aria-label="الحضور اليدوي">
  <h3>الحضور اليومي</h3>
  <p className="muted">تسجيل يدوي مع سجل تصحيحات؛ عدم وجود تسجيل لا يعني الغياب، ولا تُحسب خصومات أو رواتب تلقائيًا.</p>
  <form noValidate onSubmit={e=>void submit(e)}>
   <label className="field-label">التاريخ<input type="date" required value={day} onChange={e=>{setDay(e.target.value);setStatus("present");setNote("");setCheckIn("");setCheckOut("");setNotice("");retry.current=null}}/></label>
   {loading?<p role="status">جارٍ تحميل السجلات…</p>:null}
   <label className="field-label">الحالة
    <select value={status} onChange={e=>{setStatus(e.target.value as HRAttendanceStatus);if(e.target.value==="absent"||e.target.value==="leave"){setCheckIn("");setCheckOut("")}retry.current=null;}}>
     {Object.entries(descriptions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select>
   </label>
   {status==="present"||status==="late"?<>
    <label className="field-label">وقت الدخول (اختياري)<input type="datetime-local" value={checkIn} onChange={e=>{setCheckIn(e.target.value);retry.current=null}}/></label>
    <label className="field-label">وقت الخروج (اختياري)<input type="datetime-local" value={checkOut} onChange={e=>{setCheckOut(e.target.value);retry.current=null}}/></label>
   </>:null}
   <label className="field-label" htmlFor="employee-attendance-reason">سبب التسجيل أو التصحيح<TextArea className="resize-none" id="employee-attendance-reason" required minLength={8} maxLength={500} value={note} onChange={e=>{setNote(e.target.value);retry.current=null}}/></label>
   {selected?<p className="muted">هناك تسجيل سابق لهذا التاريخ (الإصدار {selected.version}). الحفظ التالي تصحيح موثق.</p>:<p className="muted">هذا اليوم غير مسجل؛ لا يُفترض أنه غياب.</p>}
   <div className="form-actions">
    <button className="button button-primary" disabled={busy||loading||!day||note.trim().length<8} type="submit">{busy?"جارٍ الحفظ…":selected?"حفظ تصحيح موثق":"تسجيل الحضور"}</button>

   </div>
  </form>
  {notice?<p role="status">{notice}</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {items.length>0&&Boolean(rowStatus!=="all"||rowSort!=="default"||minimumVersion)?<p className="access-center-scope">معروض من آخر 31 يومًا: {visibleRecords.length} من {items.length} تسجيلًا.</p>:null}
  <div className="access-table-wrap">
   <table className="operations-table access-table">
    <caption>آخر 31 يومًا من التسجيلات الصريحة حتى التاريخ المحدد</caption>
    <thead><tr>
      <RegistryColumnHeader label="التاريخ" scope="page" active={rowSort!=="default"}>
        <label>ترتيب الأيام<select value={rowSort} onChange={e=>setRowSort(e.target.value)}>
          <option value="default">الترتيب الأصلي</option><option value="desc">الأحدث أولًا</option><option value="asc">الأقدم أولًا</option>
        </select></label>
      </RegistryColumnHeader>
      <RegistryColumnHeader label="الحالة" scope="page" active={rowStatus!=="all"}>
        <label>حالة الحضور<select value={rowStatus} onChange={e=>setRowStatus(e.target.value)}>
          <option value="all">جميع التسجيلات</option>{Object.entries(descriptions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></label>
      </RegistryColumnHeader>
      <RegistryColumnHeader label="الإصدار" scope="page" active={Boolean(minimumVersion)}>
        <label>أقل إصدار<input type="number" min="1" step="1" value={minimumVersion} onChange={e=>setMinimumVersion(e.target.value)} /></label>
      </RegistryColumnHeader>
      <th scope="col">الإجراء</th>
    </tr></thead>
    <tbody>{visibleRecords.map(item=><tr key={item.date}><th scope="row">{item.date}</th><td>{descriptions[item.status]}</td><td>{item.version}</td><td><button type="button" className="button button-quiet" onClick={()=>setDay(item.date)}>عرض/تصحيح</button></td></tr>)}
    {visibleRecords.length===0&&!loading?<tr><td colSpan={4}>{items.length===0?"لا توجد تسجيلات لهذا النطاق؛ الأيام غير المسجلة مجهولة الحالة.":"لا توجد تسجيلات مطابقة لمرشحات الصفحة."}</td></tr>:null}</tbody>
   </table>
  </div>
 </section>;
}
