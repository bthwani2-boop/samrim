"use client";

import { formatMoney, type BeneficiaryPayoutState } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeneficiarySettlementWorkspace } from "./beneficiary-settlement-workspace";
import { CustomerWithdrawalQueue } from "./customer-withdrawal-queue";
import type { FinanceReferenceRow } from "./finance-reference-types";
import { SettlementIntakeInbox } from "./settlement-intake-inbox";
import "./finance-unified-settlements.css";

type Actor = "partner" | "captain" | "field";
type Kind = "beneficiary" | "intake" | "batch" | "withdrawal";
type Intake = Readonly<{ id: string; actorId: string; actorType: Actor; resolvedAmountMinor: number; currency: "YER"; createdAt: string }>;
type RecordItem = Readonly<{
  id: string; kind: Kind; actorType?: Actor | undefined; actorId?: string | undefined; name: string;
  amount?: number | undefined; held?: number | undefined; status: string; reference: string; reason: string;
  date?: string | undefined; beneficiary?: BeneficiaryPayoutState | undefined;
}>;
const actorNames: Record<Actor, string> = { partner: "الشريك", captain: "الكابتن", field: "سجل تاريخي" };
const kindNames: Record<Kind, string> = { beneficiary: "المستحقات", intake: "طلبات التسوية", batch: "دفعات التحويل", withdrawal: "السحوبات الاستثنائية" };
const financeStatus=(r:RecordItem)=>r.actorType==="field" && r.kind==="beneficiary"?(r.beneficiary?.latestPayout?.status ?? "سجل تاريخي"):r.kind==="beneficiary"?(r.beneficiary?.latestPayout?.status ?? (r.amount && r.amount>0?"مؤهل":"لا توجد مستحقات")):r.status;
const paramsFor=(record:RecordItem)=>({
  status:"" as const, search:record.kind==="beneficiary"?(record.actorId??""):"",
  admissionState:"all" as const,sort:"available_desc" as const,cursor:"",
  view:(record.kind==="batch"?"batches":"beneficiaries") as "batches"|"beneficiaries",
  batchId:record.kind==="batch"?record.id:"",batchStatus:record.kind==="batch"?"":"",batchCursor:""
});
export function FinanceUnifiedSettlements({rows,intakes,onChanged}:Readonly<{rows:readonly FinanceReferenceRow[];intakes:readonly Intake[];onChanged:()=>void}>) {
  const [kind,setKind]=useState<Kind>("beneficiary");
  const [actor,setActor]=useState<Actor|"all">("all");
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("all");
  const [roster,setRoster]=useState<readonly BeneficiaryPayoutState[]>([]);
  const [cursors,setCursors]=useState<Partial<Record<Actor,string>>>({});
  const [loaded,setLoaded]=useState<ReadonlyArray<Actor>>([]);
  const [failedTypes,setFailedTypes]=useState<ReadonlyArray<Actor>>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [advanced,setAdvanced]=useState(false);
  const generation=useRef(0);
  const pageInFlight=useRef(false);
  const requestController=useRef<AbortController|null>(null);
  const actorTypes=useMemo<readonly Actor[]>(()=>actor==="all"?["partner","captain"]:[actor],[actor]);

  // Both initial loading and subsequent pages use one read path and one per-actor cursor.
  const loadRoster=useCallback(async (
    types:readonly Actor[],
    append=false,
    pageCursors:Partial<Record<Actor,string>>={},
    retryTypes:ReadonlyArray<Actor>=[]
  )=>{
    const requested=append?types.filter(type=>Boolean(pageCursors[type]) || retryTypes.includes(type)):types;
    if(!requested.length || (append && pageInFlight.current))return;
    if(append)pageInFlight.current=true;
    requestController.current?.abort();
    const controller=new AbortController();
    requestController.current=controller;
    const seq=++generation.current;
    setLoading(true);setError("");
    if(!append){setRoster([]);setCursors({});setLoaded([]);setFailedTypes([]);}
    try {
      const results=await Promise.allSettled(requested.map(async type=>{
        const query=new URLSearchParams({actorType:type,limit:"50",sort:"available_desc"});
        if(append)query.set("cursor",pageCursors[type]??"");
        const response=await fetch(`/api/finance/beneficiaries?${query}`,{cache:"no-store",signal:controller.signal});
        if(!response.ok)throw Error(`تعذرت قراءة مستحقات ${actorNames[type]} (${response.status})`);
        const body=await response.json() as {beneficiaries?:BeneficiaryPayoutState[];nextCursor?:string};
        if(!Array.isArray(body.beneficiaries) || body.beneficiaries.some(item=>item.actorType!==type))throw Error("استجابة المستحقات غير صحيحة");
        return {type,items:body.beneficiaries,next:body.nextCursor??""};
      }));
      if(seq!==generation.current || controller.signal.aborted)return;
      const success=results.filter((result):result is PromiseFulfilledResult<{type:Actor;items:BeneficiaryPayoutState[];next:string}>=>result.status==="fulfilled").map(result=>result.value);
      const next=Object.fromEntries(success.map(result=>[result.type,result.next]));
      const failedActors=requested.filter((_,index)=>results[index]?.status==="rejected");
      if(append){
        setRoster(previous=>[...previous,...success.flatMap(result=>result.items)]);
        setLoaded(previous=>[...new Set([...previous,...success.map(result=>result.type)])]);
        setCursors(previous=>({...previous,...next}));
        setFailedTypes(previous=>[...new Set([...previous.filter(type=>!requested.includes(type)),...failedActors])]);
      }else{
        setRoster(success.flatMap(result=>result.items));
        setLoaded(success.map(result=>result.type));
        setCursors(next);
        setFailedTypes(failedActors);
      }
      const failed=failedActors.length;
      if(failed)setError(`تعذرت قراءة ${failed} من مصادر المستحقات؛ ${success.length?"البيانات المعروضة جزئية. أعد المحاولة لتحميل الباقي.":"أعد المحاولة."}`);
    }finally{
      if(requestController.current===controller){
        requestController.current=null;
        if(append)pageInFlight.current=false;
      }
      if(seq===generation.current && !controller.signal.aborted)setLoading(false);
    }
  },[]);
  useEffect(()=>{
    if(kind!=="beneficiary"){
      setLoading(false);
      setError("");
      return;
    }
    void loadRoster(actorTypes);
    return()=>{
      generation.current++;
      requestController.current?.abort();
      requestController.current=null;
      pageInFlight.current=false;
    };
  },[actorTypes,kind,loadRoster]);

  const records=useMemo<RecordItem[]>(()=>{
    if(kind==="beneficiary")return roster.map(b=>({
      id:`beneficiary:${b.actorType}:${b.actorId}`,kind,actorType:b.actorType==="customer"?undefined:b.actorType,
      actorId:b.actorId,name:b.displayName?.trim()||b.actorId,amount:b.eligibleAvailableMinor,held:b.heldMinor,
      status:b.latestPayout?.status??"",reference:b.actorId,reason:b.actorType==="field"?"سجل مالي تاريخي للقراءة فقط؛ تتطلب الالتزامات القائمة مراجعة Finance":b.destination?"جهة الاستلام مسجلة":"تحقق من جهة الاستلام",
      beneficiary:b
    }));
    if(kind==="intake")return intakes.map(i=>({
      id:`intake:${i.id}`,kind,actorType:i.actorType,actorId:i.actorId,
      name:`${actorNames[i.actorType]} · ${i.actorId}`,amount:i.resolvedAmountMinor,status:"بانتظار المراجعة",
      reference:i.id,reason:"التحقق من جهة الصرف",date:i.createdAt
    }));
    const source=kind==="batch"?"batches":"withdrawals";
    return rows.filter(r=>r.source===source).map(r=>({
      id:`${kind}:${r.id}`,kind,name:r.subject,amount:r.amountMinor,status:r.state,
      reference:r.id,reason:r.nextStep,date:r.date
    }));
  },[kind,roster,intakes,rows]);
  const filtered=useMemo(()=>records.filter(record=>
    (actor==="all"||record.actorType===actor) &&
    (status==="all"|| (status==="action" ? record.kind==="intake"||record.reason.includes("تحقق"):status==="ready"?Number(record.amount)>0:status==="held"?Number(record.held)>0:true)) &&
    [record.name,record.actorId??"",record.reference,record.status,record.reason].some(x=>x.toLocaleLowerCase("ar").includes(search.trim().toLocaleLowerCase("ar")))
  ),[records,actor,status,search]);
  const active=records.find(r=>r.id===selected)??null;
  const hasNextPage=actorTypes.some(type=>Boolean(cursors[type]));
  const needsRetry=failedTypes.some(type=>actorTypes.includes(type));
  const canLoadMore=kind==="beneficiary" && (hasNextPage || needsRetry);
  const chooseKind=(next:Kind)=>{setKind(next);setActor("all");setSearch("");setStatus("all");setSelected(null);setAdvanced(false);};
  const showRecord=(record:RecordItem)=>{setSelected(record.id);setAdvanced(false);};
  const close=()=>{setSelected(null);setAdvanced(false);onChanged();};
  return <section className="fs-page fu-workspace" aria-label="الصرف والتسويات">
    <div className="fs-head"><div><h2>الصرف والتسويات</h2><p>سجل مالي واحد للمستحقات والدفعات والسحوبات؛ افتح التفاصيل عند الحاجة فقط.</p></div><span className="fs-period">الأرقام من المصادر المحمّلة · الصرف يخضع للصلاحيات</span></div>
    <div className="fu-toolbar">
      <label>نوع السجل<select aria-label="نوع السجل المالي" value={kind} onChange={e=>chooseKind(e.target.value as Kind)}><option value="beneficiary">المستحقات</option><option value="intake">طلبات التسوية</option><option value="batch">دفعات التحويل</option><option value="withdrawal">السحوبات الاستثنائية</option></select></label>
      <label>صاحب المصلحة<select aria-label="نوع المستفيد" value={actor} onChange={e=>{setActor(e.target.value as Actor|"all");setSelected(null)}} disabled={kind==="batch"||kind==="withdrawal"}><option value="all">جميع الأطراف</option><option value="partner">الشركاء</option><option value="captain">الكباتن</option><option value="field">الميدان — سجلات تاريخية</option></select></label>
      <label>الحالة<select aria-label="حالة السجل" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">جميع الحالات</option><option value="action">تحتاج مراجعة</option><option value="ready">مبلغ مؤهل</option><option value="held">مبلغ محجوز</option></select></label>
      <label className="fu-search">بحث<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="الاسم أو المرجع أو رقم العملية"/></label>
    </div>
    {error?<p className="fs-error" role="alert">{error}</p>:null}
    <div className={active?"fu-layout fu-with-inspector":"fu-layout"}>
      <div className="fs-panel fu-list">
        <div className="fs-panel-heading"><h3>{kindNames[kind]}</h3><small>{loaded.length&&kind==="beneficiary"?"السجلات المسترجعة: ":"السجلات المعروضة: "}{filtered.length.toLocaleString("ar-YE")}{canLoadMore?hasNextPage?" · توجد صفحات أخرى":" · مصادر لم تُحمّل بعد":""}</small></div>
        <div className="fs-table-scroll"><table><caption className="sr-only">سجلات الصرف والتسويات المعروضة</caption><thead><tr><th scope="col">الطرف / المرجع</th><th scope="col">النوع</th><th scope="col">المبلغ المؤهل / المطلوب</th><th scope="col">المحجوز</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead><tbody>
          {filtered.map(record=><tr key={record.id} className={active?.id===record.id?"fu-selected":""}><td><strong>{record.name}</strong><small dir="auto">{record.reference}</small></td><td>{kindNames[record.kind]}{record.actorType?` · ${actorNames[record.actorType]}`:""}</td><td dir="ltr" className="fu-money">{record.amount===undefined?"—":formatMoney(record.amount, "YER")}</td><td dir="ltr">{record.held===undefined?"—":formatMoney(record.held, "YER")}</td><td>{financeStatus(record)}</td><td><button type="button" className="fs-action" aria-label={`تفاصيل ${record.name}`} onClick={()=>showRecord(record)}>التفاصيل ←</button></td></tr>)}
        </tbody></table>{!filtered.length?<p className="fs-empty">{loading?"جارٍ قراءة البيانات...":error?"لم تكتمل قراءة مصادر المستحقات؛ أعد المحاولة.":"لا توجد سجلات مطابقة ضمن البيانات المحمّلة."}</p>:null}</div>
        {canLoadMore?<button type="button" className="fs-secondary" disabled={loading} onClick={()=>void loadRoster(actorTypes,true,cursors,failedTypes)}>{loading?"جارٍ التحميل...":hasNextPage?needsRetry?"تحميل المزيد وإعادة المحاولة":"تحميل الصفحة التالية":"إعادة محاولة المصادر المتعثرة"}</button>:null}
        <p className="fs-note">البحث يعمل في السجلات المحمّلة، ولا يعد بحثًا شاملًا في جميع صفحات الدفتر. لا تُستنتج الإجماليات من هذه القائمة.</p>
      </div>
      {active?<aside className="fs-panel fu-inspector" aria-label="تفاصيل السجل المالي">
        <div className="fs-panel-heading"><h3>تفاصيل {kindNames[active.kind]}</h3><button type="button" className="fu-close" aria-label="إغلاق تفاصيل السجل المالي" onClick={close}>×</button></div>
        <div className="fu-hero"><small>المبلغ المعتمد في المصدر</small><strong dir="ltr">{active.amount===undefined?"—":formatMoney(active.amount, "YER")}</strong></div>
        <dl className="fu-facts"><dt>المستفيد</dt><dd>{active.name}</dd><dt>المرجع</dt><dd dir="auto">{active.reference}</dd><dt>الحالة</dt><dd>{financeStatus(active)}</dd>{active.held!==undefined?<><dt>المحجوز</dt><dd>{formatMoney(active.held, "YER")}</dd></>:null}<dt>الإجراء التالي</dt><dd>{active.reason}</dd></dl>
        {active.beneficiary?<div className="fu-destination"><strong>جهة الاستلام</strong><p>{active.beneficiary.destination?"توجد جهة استلام مسجلة؛ تحقق من صلاحيتها قبل الصرف.":"لا توجد جهة استلام معتمدة في هذا السجل."}</p></div>:null}
        {active.actorType==="field"?<p role="status" className="fs-note">سجل مالي تاريخي للقراءة فقط. لا ينشئ طلب صرف أو اعتمادًا جديدًا.</p>:<button type="button" className="fu-advanced-toggle" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>{advanced?"إخفاء إجراءات السجل":"فتح إجراءات السجل المعتمدة"} <span aria-hidden="true">{advanced?"−":"+"}</span></button>}
      </aside>:null}
    </div>
    {advanced&&active&&active.actorType!=="field"?<section className="fu-operations-sheet" aria-label="إجراءات السجل المالي المعتمدة">
      <div className="fu-operations-header"><div><h3>إجراءات {kindNames[active.kind]}</h3><p>{active.name} · <span dir="auto">{active.reference}</span></p></div>
        <button type="button" className="fs-secondary" onClick={()=>setAdvanced(false)}>العودة إلى التفاصيل ←</button>
      </div>
      <div className="fu-advanced-actions">
        {active.kind==="intake"?<SettlementIntakeInbox search={active.reference} visible/>:active.kind==="withdrawal"?<CustomerWithdrawalQueue initialQuery={{status:"REQUESTED",search:"",sort:"requested_desc",cursor:"",intakeId:active.reference}}/>:<BeneficiarySettlementWorkspace actorType={active.actorType??"partner"} initialQuery={paramsFor(active)}/>}
      </div>
    </section>:null}
  </section>;
}
