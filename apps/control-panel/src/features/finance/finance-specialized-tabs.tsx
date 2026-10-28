"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FinanceWalletRegistry } from "./finance-wallet-registry";
import { financeAmount } from "./finance-amount";
import { FinanceUnifiedSettlements } from "./finance-unified-settlements";
import { SettlementIntakeInbox } from "./settlement-intake-inbox";
import type { FinanceReferenceRow, FinanceReferenceTab, FinanceReferenceWorkflow } from "./finance-reference-dashboard";
import "./finance-specialized-tabs.css";

type ActorType = "customer" | "partner" | "captain" | "field";
type Intake = Readonly<{ id:string; actorId:string; actorType:"partner"|"captain"|"field"; resolvedAmountMinor:number; currency:"YER"; createdAt:string }>;
type WalletSummary = Readonly<{ actorId:string; actorType:ActorType; displayName?:string; beneficiaryName?:string; currentBalanceMinor:number; heldMinor:number; availableMinor:number }>;
type LedgerEntry = Readonly<{ transactionId:string; transactionType:string; direction:"CREDIT"|"DEBIT"; amountMinor:number; balanceAfterMinor:number; createdAt:string; sourceId:string; sourceType:string; order?:Readonly<{orderId:string;storeName:string}> }>;
type Statement = Readonly<{ currentBalanceMinor:number; openingBalanceMinor:number; closingBalanceMinor:number; creditsMinor:number; debitsMinor:number; entries:readonly LedgerEntry[]; nextCursor?:string }>;
type ViewProps = Readonly<{ rows:readonly FinanceReferenceRow[]; intakes:readonly Intake[]; hasMore:boolean; onOpenWorkflow:(workflow:FinanceReferenceWorkflow,row:FinanceReferenceRow|null)=>void; onReloadIntakes:()=>void }>;
const actors:ReadonlyArray<{key:ActorType;label:string}> = [{key:"customer",label:"العملاء"},{key:"partner",label:"الشركاء"},{key:"captain",label:"الكباتن"},{key:"field",label:"أرشيف الميداني"}];
const cashSources = [{key:"custody",label:"تحصيل COD"},{key:"commissions",label:"ذمم العمولات"}] as const;
const num=(v:number)=>new Intl.NumberFormat("ar-YE",{maximumFractionDigits:0}).format(v);
const money=(amount:number)=>financeAmount(amount);
const shortDate=(date?:string)=>date && !Number.isNaN(Date.parse(date))?new Intl.DateTimeFormat("ar-YE",{dateStyle:"medium",timeZone:"Asia/Aden"}).format(new Date(date)):"—";
const daysOld=(date?:string)=>date && !Number.isNaN(Date.parse(date))?Math.max(0,Math.floor((Date.now()-Date.parse(date))/86400000)):null;
const isoYemen=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Aden",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const dateRange=()=>{const to=new Date(),from=new Date(to);from.setUTCDate(from.getUTCDate()-29);return {from:isoYemen(from),to:isoYemen(to)};};
const names:Record<FinanceReferenceTab,string>={command:"القيادة",wallets:"المحافظ",activity:"الحركات",collection:"التحصيل",pending:"المعلقة",settlements:"الصرف والتسويات",reconcile:"المطابقة",reports:"التقارير"};
const descriptions:Record<FinanceReferenceTab,string>={command:"الصورة المالية الشاملة",wallets:"أرصدة وملفات جميع أصحاب المصلحة",activity:"كشوف الحركات المالية ومراجعها",collection:"التحصيل النقدي وذمم العمولات",pending:"حالات التعثر والقرارات المطلوبة",settlements:"مستحقات الأطراف ودفعات الصرف",reconcile:"مراجعة الفروقات والأدلة المحاسبية",reports:"إعداد كشوف قابلة للتدقيق والتصدير"};

function Header({tab,detail}:Readonly<{tab:FinanceReferenceTab;detail?:string}>){
 return <div className="fs-head"><div><h2>{names[tab]}</h2><p>{detail??descriptions[tab]}</p></div><span className="fs-period">جميع الأرقام المالية من السجلات المتاحة فقط</span></div>;
}
function Card({name,value,note,tone="blue"}:Readonly<{name:string;value:string;note?:string;tone?:"blue"|"orange"|"green"|"red"}>) {
 return <div className={"fs-summary fs-"+tone}><span>{name}</span><strong dir="auto">{value}</strong>{note?<small>{note}</small>:null}</div>;
}
function Action({label,onClick}:Readonly<{label:string;onClick:()=>void}>){return <button type="button" className="fs-action" onClick={onClick}>{label} <span aria-hidden="true">←</span></button>;}
function Download({rows,file}:Readonly<{rows:readonly FinanceReferenceRow[];file:string}>){
 const download=()=>{
  const cols=[["الأولوية","النوع","المستفيد","المرجع","الحالة","المبلغ","السبب"],...rows.map(r=>[String(r.priority),r.category,r.subject,r.reference,r.state,r.amount,r.nextStep])];
  const csv="\uFEFF"+cols.map(cols=>cols.map(v=>'"'+v.replaceAll('"','""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})), link=document.createElement("a");link.href=url;link.download=file+".csv";link.click();URL.revokeObjectURL(url);
 };
 return <button className="fs-secondary" type="button" disabled={!rows.length} onClick={download}>تصدير CSV · {num(rows.length)} سجل</button>;
}
function StateTag({priority}:Readonly<{priority:number}>){return <span className={"fs-status fs-status-"+(priority===1?"red":priority===2?"orange":"blue")}>{priority===1?"عاجلة":priority===2?"عالية":"متابعة"}</span>}
function Registry({rows,onOpen,empty="لا توجد سجلات في هذه المعاينة.",showAge=false}:Readonly<{rows:readonly FinanceReferenceRow[];onOpen:(row:FinanceReferenceRow)=>void;empty?:string;showAge?:boolean}>){
 const [search,setSearch]=useState("");const [page,setPage]=useState(1);
 const filtered=useMemo(()=>rows.filter(r=>[r.reference,r.subject,r.state,r.category,r.nextStep,r.amount].some(v=>v.toLocaleLowerCase("ar").includes(search.trim().toLocaleLowerCase("ar")))),[rows,search]);
 const pages=Math.max(1,Math.ceil(filtered.length/10)),actual=Math.min(page,pages);
 return <div className="fs-register">
  <div className="fs-toolbar"><label><span>⌕</span><input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="بحث ضمن السجلات المعروضة" aria-label="البحث في السجلات المعروضة"/></label><span className="fs-count">{num(filtered.length)} سجل محمّل</span></div>
  <div className="fs-table-scroll"><table><thead><tr><th>الأولوية</th><th>المستفيد</th><th>نوع العملية</th><th>المبلغ</th><th>الحالة / السبب</th>{showAge?<th>العمر</th>:null}<th>المرجع</th><th>الإجراء</th></tr></thead><tbody>{filtered.slice((actual-1)*10,actual*10).map(r=><tr key={r.key}><td><StateTag priority={r.priority}/></td><td>{r.subject}</td><td>{r.category}</td><td dir="auto" className="fs-amount">{r.amount}</td><td className="fs-reason">{r.nextStep}</td>{showAge?<td>{daysOld(r.date)===null?"غير محدد":num(daysOld(r.date)!)+" يوم"}</td>:null}<td dir="auto" className="fs-ref">{r.reference}</td><td><Action label="فتح" onClick={()=>onOpen(r)}/></td></tr>)}</tbody></table>
  {!filtered.length?<div className="fs-empty">{empty}</div>:null}</div>
  <div className="fs-foot"><span>{num(Math.min((actual-1)*10+1,filtered.length))}–{num(Math.min(actual*10,filtered.length))} من {num(filtered.length)} · المعروض ليس بالضرورة كامل الدفتر</span><div><button type="button" disabled={actual<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>السابق</button><span>{num(actual)} / {num(pages)}</span><button type="button" disabled={actual>=pages} onClick={()=>setPage(p=>p+1)}>التالي</button></div></div>
 </div>;
}
function WalletsView(){
 return <section className="fs-page"><Header tab="wallets"/><div className="fs-wallet-view"><FinanceWalletRegistry/></div></section>;
}
function ActivityView({onOpenWorkflow}:ViewProps){
 const [actor,setActor]=useState<ActorType>("customer"),[wallets,setWallets]=useState<readonly WalletSummary[]>([]),[cursor,setCursor]=useState(""),[selected,setSelected]=useState<string>(""),[statement,setStatement]=useState<Statement|null>(null),[entries,setEntries]=useState<readonly LedgerEntry[]>([]),[next,setNext]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [from,setFrom]=useState(()=>dateRange().from),[to,setTo]=useState(()=>dateRange().to);
 const walletsRequest = useRef(0), statementRequest = useRef(0);
 const loadWallets=useCallback(async (after="")=>{
  if(!from||!to||from>to){setError("حدد نطاقًا زمنيًا صحيحًا.");return;}
  const request=++walletsRequest.current;setBusy(true);setError("");
  try{const p=new URLSearchParams({actorType:actor,from,to});if(after)p.set("cursor",after);const res=await fetch("/api/finance/financial-statements?"+p,{cache:"no-store"});if(!res.ok)throw Error("تعذرت قراءة قائمة المحافظ");const body=await res.json() as {summaries?:WalletSummary[];nextCursor?:string};if(!Array.isArray(body.summaries))throw Error("بيانات المحافظ غير صالحة");if(request!==walletsRequest.current)return;setWallets(old=>after?[...old,...body.summaries!]:body.summaries!);setCursor(body.nextCursor??"");
  }catch(e){if(request===walletsRequest.current)setError(e instanceof Error?e.message:"تعذرت قراءة المحافظ");}finally{if(request===walletsRequest.current)setBusy(false);}
 },[actor,from,to]);
 useEffect(()=>{let alive=true;const f=async()=>{if(alive)await loadWallets()};void f();return()=>{alive=false}},[loadWallets]);
 const loadStatement=useCallback(async (actorId:string,after="")=>{
  if(!actorId)return;const request=++statementRequest.current;setBusy(true);setError("");
  try{const p=new URLSearchParams({from,to});if(after)p.set("cursor",after);const res=await fetch("/api/finance/beneficiaries/"+encodeURIComponent(actor)+"/"+encodeURIComponent(actorId)+"/financial-statement?"+p,{cache:"no-store"});if(!res.ok)throw Error("تعذرت قراءة كشف المحفظة");const data=await res.json() as {statement?:Statement};if(!data.statement||!Array.isArray(data.statement.entries))throw Error("كشف الحساب غير صالح");if(request!==statementRequest.current)return;setStatement(data.statement);setEntries(old=>after?[...old,...data.statement!.entries]:data.statement!.entries);setNext(data.statement.nextCursor??"");
  }catch(e){if(request===statementRequest.current)setError(e instanceof Error?e.message:"تعذرت قراءة الكشف");}finally{if(request===statementRequest.current)setBusy(false);}
 },[actor,from,to]);
 const resetSelection=()=>{walletsRequest.current++;statementRequest.current++;setWallets([]);setCursor("");setSelected("");setStatement(null);setEntries([]);setNext("");};
 const wallet=wallets.find(w=>w.actorId===selected);
 return <section className="fs-page">
  <Header tab="activity" detail="اختر صاحب المحفظة لقراءة كشف WLT التفصيلي، ثم افتح الحركة ومرجعها."/>
  <div className="fs-inline-filters"><select aria-label="نوع المستفيد" value={actor} onChange={e=>{resetSelection();setActor(e.target.value as ActorType)}}>{actors.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select><label>من <input type="date" value={from} onChange={e=>{resetSelection();setFrom(e.target.value)}}/></label><label>إلى <input type="date" value={to} onChange={e=>{resetSelection();setTo(e.target.value)}}/></label><Action label="الحركات التشغيلية" onClick={()=>onOpenWorkflow("custody",null)}/></div>
  {error?<div role="alert" className="fs-error">{error}</div>:null}
  <div className="fs-activity-grid"><div className="fs-panel"><div className="fs-panel-heading"><h3>الحسابات المالية</h3><small>حدد محفظة لعرض كشفها</small></div><div className="fs-accounts">{wallets.map(w=><button type="button" key={w.actorId} aria-pressed={selected===w.actorId} onClick={()=>{setSelected(w.actorId);setStatement(null);setEntries([]);void loadStatement(w.actorId)}}><span dir="auto">{w.displayName??w.beneficiaryName??w.actorId}</span><strong dir="ltr">{money(w.currentBalanceMinor)}</strong></button>)}</div>{!wallets.length&&!busy?<p className="fs-empty">لا توجد محافظ لهذه الفئة في الفترة المحددة.</p>:null}{cursor?<button type="button" className="fs-secondary" disabled={busy} onClick={()=>void loadWallets(cursor)}>المزيد من الحسابات</button>:null}</div>
  <div className="fs-panel"><div className="fs-panel-heading"><h3>كشف الحركات المالية</h3><span>{wallet?"الرصيد الحالي: "+money(wallet.currentBalanceMinor):"اختر حسابًا"}</span></div>
   {statement?<div className="fs-ledger-summary"><span>إضافات الفترة <b dir="ltr">{money(statement.creditsMinor)}</b></span><span>خصومات الفترة <b dir="ltr">{money(statement.debitsMinor)}</b></span><span>إقفال الفترة <b dir="ltr">{money(statement.closingBalanceMinor)}</b></span></div>:null}
   <div className="fs-table-scroll"><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>الإضافة / الخصم</th><th>الرصيد بعد القيد</th></tr></thead><tbody>{entries.map(e=><tr key={e.transactionId}><td>{shortDate(e.createdAt)}</td><td>{e.transactionType.replaceAll("_"," ")}</td><td dir="auto" className="fs-ref">{e.order?.orderId??e.sourceId}</td><td className={e.direction==="CREDIT"?"fs-positive":"fs-negative"} dir="ltr">{e.direction==="CREDIT"?"+":"−"} {money(e.amountMinor)}</td><td dir="ltr">{money(e.balanceAfterMinor)}</td></tr>)}</tbody></table>{!entries.length?<p className="fs-empty">{busy?"جارٍ قراءة الكشف...":"اختر محفظة؛ لا تُعرض قيود تقديرية."}</p>:null}</div>
   {next?<button type="button" className="fs-secondary" disabled={busy} onClick={()=>void loadStatement(selected,next)}>تحميل الحركات الأقدم</button>:null}
  </div></div>
 </section>;
}
function CollectionView({rows,onOpenWorkflow,hasMore}:ViewProps){
 const [source,setSource]=useState<"custody"|"commissions">("custody");
 const records=rows.filter(r=>r.source===source), sum=records.reduce((v,r)=>v+(r.amountMinor??0),0), known=records.some(r=>r.amountMinor!==undefined);
 return <section className="fs-page"><Header tab="collection"/><div className="fs-metrics"><Card name="تحصيلات نقدية معروضة" value={money(rows.filter(r=>r.source==="custody").reduce((v,r)=>v+(r.amountMinor??0),0))} note="المبالغ المحملة · ليست الإجمالي الشامل" tone="green"/><Card name="حالات التحصيل" value={num(rows.filter(r=>r.source==="custody").length)} note="ضمن السجل الحالي" tone="blue"/><Card name="ذمم العمولات" value={money(rows.filter(r=>r.source==="commissions").reduce((v,r)=>v+(r.amountMinor??0),0))} note="مبالغ ما زالت مستحقة" tone="orange"/></div>
 <div className="fs-toolbar fs-collection-controls">{cashSources.map(s=><button type="button" className={source===s.key?"fs-selected":""} key={s.key} onClick={()=>setSource(s.key)}>{s.label}</button>)}<Action label="فتح سجل التحصيل الكامل" onClick={()=>onOpenWorkflow(source,null)}/></div>
 <div className="fs-panel"><div className="fs-panel-heading"><h3>{source==="custody"?"التحصيلات والتوريدات":"ذمم عمولة المنصة"}</h3><small>{known?money(sum):"لا يوجد مجموع متاح"} {hasMore?"· توجد صفحات أخرى":""}</small></div><Registry rows={records} onOpen={r=>onOpenWorkflow(r.source,r)}/></div></section>;
}
function PendingView({rows,intakes,onOpenWorkflow,onReloadIntakes}:ViewProps){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<FinanceReferenceRow|null>(null);
 const cases:FinanceReferenceRow[]=useMemo(()=>[
  ...intakes.map(i=>({source:"batches" as const,id:i.id,key:"intake:"+i.id,subject:(i.actorType==="field"?"ميداني":i.actorType==="captain"?"كابتن":"شريك")+" · "+i.actorId,reference:i.id,category:"تسوية مستحقات",state:"بانتظار جهة الصرف",amount:money(i.resolvedAmountMinor),amountMinor:i.resolvedAmountMinor,priority:1,nextStep:"التحقق من جهة صرف المستفيد",date:i.createdAt})),
  ...rows.filter(r=>r.priority<=2)
 ].sort((a,b)=>a.priority-b.priority||String(a.date??"").localeCompare(String(b.date??""))),[intakes,rows]);
 const onCase=(r:FinanceReferenceRow)=>setSelected(r);
 return <section className="fs-page"><Header tab="pending" detail="القرارات المتعثرة ومدة انتظارها، مع أسباب واضحة وإجراءات مرتبطة بالسجل الأصلي."/>
 <div className="fs-metrics"><Card name="حالات تتطلب تدخلاً" value={num(cases.length)} note="ضمن المصادر المحملة" tone="red"/><Card name="طلبات تسوية بانتظار التحقق" value={num(intakes.length)} note="سجل التسويات الوارد" tone="orange"/><Card name="المبالغ في الطابور" value={money(cases.reduce((v,r)=>v+(r.amountMinor??0),0))} note="قيمة الحالات المتاحة فقط" tone="blue"/></div>
 <div className={selected?"fs-split":"fs-split fs-full"}><div className="fs-panel"><div className="fs-panel-heading"><h3>طابور القرارات المالية</h3><small>الأولوية قبل ترتيب المبلغ</small></div><Registry rows={cases} showAge onOpen={onCase}/></div>
 {selected ? <aside className="fs-panel fs-pending-inspector"><div className="fs-panel-heading"><h3>ملف القرار</h3><small>تفاصيل عند الاختيار فقط</small></div>{selected?<><h4>{selected.category} · {selected.subject}</h4><strong className="fs-inspector-money">{selected.amount}</strong><dl><dt>المرجع</dt><dd dir="auto">{selected.reference}</dd><dt>السبب</dt><dd>{selected.nextStep}</dd><dt>العمر</dt><dd>{daysOld(selected.date)===null?"غير مسجل":num(daysOld(selected.date)!)+" يوم"}</dd></dl><Action label="فتح مصدر الحالة" onClick={()=>selected.key.startsWith("intake:")?setOpen(true):onOpenWorkflow(selected.source,selected)}/></>:<p className="fs-empty">حدد حالة لعرض سبب التعثر وأدلتها وإجراء المراجعة.</p>}</aside> : null}</div>
 {open?<div className="fs-panel"><div className="fs-panel-heading"><h3>مراجعة طلبات التسوية الواردة</h3><button type="button" className="fs-secondary" onClick={()=>{setOpen(false);onReloadIntakes()}}>إغلاق</button></div><SettlementIntakeInbox visible/></div>:null}</section>;
}
function ReconcileView({rows,onOpenWorkflow}:ViewProps){
 const [selected,setSelected]=useState<"custody"|"batches"|"commissions">("custody");
 const options=[{id:"custody" as const,label:"توريدات COD",description:"المقارنة بين التحصيل والإيصالات"},{id:"batches" as const,label:"دفعات التسويات",description:"مطابقة التحويلات والأدلة"},{id:"commissions" as const,label:"ذمم العمولات",description:"التحقق من القيود المحصلة"}];
 const candidates=rows.filter(r=>r.source===selected);
 return <section className="fs-page"><Header tab="reconcile" detail="تتبع أدلة المطابقة والمراجع بين المصادر المعتمدة. لا يُنشأ قيد تصحيحي تلقائيًا."/>
 <div className="fs-source-flow"><div><strong>WLT</strong><small>الدفتر المالي</small></div><span>⇆</span><div><strong>DSH</strong><small>الطلبات والمستحقات</small></div><span>⇆</span><div><strong>COD</strong><small>التحصيل والتوريدات</small></div><span>⇆</span><div><strong>مزود الدفع</strong><small>بيانات التسوية الخارجية</small></div></div>
 <div className="fs-reconcile-status"><span>حالة المطابقة الشاملة: <strong>غير محسوبة</strong></span><span>لا تتوفر نتيجة آلية موحدة لإجمالي الفروقات عبر المصادر.</span></div>
 <div className="fs-reconcile-options">{options.map(o=><button type="button" key={o.id} aria-pressed={selected===o.id} onClick={()=>setSelected(o.id)}><strong>{o.label}</strong><small>{o.description}</small><b>{num(rows.filter(r=>r.source===o.id).length)} سجلات</b></button>)}</div>
 <div className="fs-panel"><div className="fs-panel-heading"><h3>سجلات {options.find(o=>o.id===selected)?.label} للمراجعة</h3><Action label="فتح إجراءات المطابقة" onClick={()=>onOpenWorkflow(selected,null)}/></div><Registry rows={candidates} onOpen={r=>onOpenWorkflow(r.source,r)} empty="لا توجد سجلات محمّلة لهذه الفئة. لا يعني ذلك إثبات مطابقة جميع القيود."/></div></section>;
}
function ReportsView({rows,onOpenWorkflow}:ViewProps){
 const [kind,setKind]=useState<"all"|"custody"|"commissions"|"batches"|"withdrawals">("all"),[from,setFrom]=useState(()=>dateRange().from),[to,setTo]=useState(()=>dateRange().to);
 const allowed=from<=to&&Boolean(from)&&Boolean(to);
 const scoped=rows.filter(r=>kind==="all"||r.source===kind);
 const excludedNoDate=scoped.filter(r=>!r.date).length;
 const report=scoped.filter(r=>Boolean(r.date)&&allowed&&r.date!.slice(0,10)>=from&&r.date!.slice(0,10)<=to);
 const reports=[{key:"all",label:"ملخص المالية",note:"من المعاملات المحمّلة"},{key:"custody",label:"تحصيل COD",note:"التحصيلات النقدية"},{key:"commissions",label:"ذمم العمولات",note:"المبالغ المستحقة"},{key:"batches",label:"دفعات التسوية",note:"الدفعات المعروضة"},{key:"withdrawals",label:"سحوبات العملاء",note:"طلبات السحب الاستثنائية"}] as const;
 return <section className="fs-page"><Header tab="reports" detail="إنشاء التقارير من السجلات المتاحة فقط، مع إظهار حدود التغطية والمرجعية."/>
 <div className="fs-report-tiles">{reports.map(r=><button type="button" key={r.key} aria-pressed={kind===r.key} onClick={()=>setKind(r.key)}><strong>{r.label}</strong><small>{r.note}</small></button>)}</div>
 <div className="fs-panel"><div className="fs-panel-heading"><h3>تكوين التقرير</h3><small>تصدير CSV مع دعم العربية</small></div><div className="fs-inline-filters"><label>من <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>إلى <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><select aria-label="نوع التقرير" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>{reports.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select><Download rows={allowed?report:[]} file={"bthwani-"+kind+"-report"}/></div>{!allowed?<p role="alert" className="fs-error">تاريخ البداية لا يمكن أن يتجاوز تاريخ النهاية.</p>:null}<p className="fs-note">التصدير يشمل السجلات المؤرخة المحمّلة فقط، وليس تقريرًا محاسبيًا شاملاً. استُبعد {num(excludedNoDate)} سجلًا دون تاريخ مثبت في هذه المعاينة.</p></div>
 <div className="fs-metrics"><Card name="السجلات في العرض" value={num(report.length)} note="ضمن المصادر المحمّلة"/><Card name="القيمة المعروفة" value={money(report.reduce((v,r)=>v+(r.amountMinor??0),0))} note="لا يشمل القيم غير المتاحة" tone="green"/><Card name="الحالات العالية الأولوية" value={num(report.filter(r=>r.priority<=2).length)} note="في التقرير المحدد" tone="orange"/></div>
 <div className="fs-panel"><div className="fs-panel-heading"><h3>معاينة التقرير</h3><span>{reports.find(r=>r.key===kind)?.label}</span></div><Registry rows={report} onOpen={r=>onOpenWorkflow(r.source,r)}/></div></section>;
}
export function FinanceSpecializedTab({tab,...props}:ViewProps & Readonly<{tab:FinanceReferenceTab}>){
 if(tab==="wallets")return <WalletsView/>;
 if(tab==="activity")return <ActivityView {...props}/>;
 if(tab==="collection")return <CollectionView {...props}/>;
 if(tab==="pending")return <PendingView {...props}/>;
 if(tab==="settlements")return <FinanceUnifiedSettlements rows={props.rows} intakes={props.intakes} onChanged={props.onReloadIntakes}/>;
 if(tab==="reconcile")return <ReconcileView {...props}/>;
 return <ReportsView {...props}/>;
}
