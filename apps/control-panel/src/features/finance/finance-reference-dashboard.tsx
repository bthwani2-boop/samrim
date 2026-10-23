"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FinanceWalletRegistry } from "./finance-wallet-registry";
import { SettlementIntakeInbox } from "./settlement-intake-inbox";
import "./finance-reference-dashboard.css";

export type FinanceReferenceRow = Readonly<{
  key: string; source: "custody" | "commissions" | "batches" | "withdrawals";
  id: string; subject: string; reference: string; category: string; state: string;
  amount: string; amountMinor?: number; priority: number; nextStep: string; date?: string;
}>;
export type FinanceReferenceWorkflow = "custody" | "commissions" | "batches" | "withdrawals" | "settlement-partner" | "settlement-captain" | "settlement-field" | "agreements";
export type FinanceReferenceTab = "command" | "wallets" | "activity" | "collection" | "settlements" | "reconcile" | "pending" | "reports";
type ActorType = "customer" | "partner" | "captain" | "field";
type WalletSummary = Readonly<{ actorId: string; currentBalanceMinor: number; heldMinor: number; availableMinor: number; creditsMinor: number; debitsMinor: number; currency: "YER" }>;
type WalletRegistry = Readonly<{ summaries: readonly WalletSummary[]; nextCursor?: string }>;
type WalletGroup = Readonly<{ type: ActorType; name: string; amount: number; count: number; loaded: boolean; complete: boolean; error?: string }>;
type Intake = Readonly<{ id: string; actorId: string; actorType: "partner" | "captain" | "field"; resolvedAmountMinor: number; currency: "YER"; createdAt: string }>;
const groupDefinitions = [
  { type: "customer", name: "العملاء", icon: "users", color: "#2289ff" },
  { type: "partner", name: "الشركاء", icon: "store", color: "#ff8737" },
  { type: "captain", name: "الكباتن", icon: "truck", color: "#17c69a" },
  { type: "field", name: "الميدانيون", icon: "user", color: "#ac65e9" },
] as const;
const tabs = [
  { key: "command", label: "القيادة", icon: "dashboard" }, { key: "wallets", label: "المحافظ", icon: "wallet" },
  { key: "activity", label: "الحركات", icon: "activity" }, { key: "collection", label: "التحصيل", icon: "inbox" },
  { key: "pending", label: "المعلقة", icon: "clock" }, { key: "settlements", label: "الصرف والتسويات", icon: "transfer" },
  { key: "reconcile", label: "المطابقة", icon: "scale" }, { key: "reports", label: "التقارير", icon: "chart" },
] as const;
const workflowLabels: Record<FinanceReferenceWorkflow, string> = {
  custody: "التحصيل النقدي والتوريدات", commissions: "ذمم عمولة المنصة", batches: "دفعات التحويل والمطابقة",
  withdrawals: "سحوبات العملاء", "settlement-partner": "مستحقات الشركاء",
  "settlement-captain": "مستحقات الكباتن", "settlement-field": "مستحقات الميدانيين", agreements: "اتفاقات المتاجر",
};
const emptyGroups: readonly WalletGroup[] = groupDefinitions.map((group) => ({ type: group.type, name: group.name, amount: 0, count: 0, loaded: false, complete: false }));
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
const riyals = (minor: number) => number(Math.round(minor / 100));
const displayMoney = (minor: number) => riyals(minor) + " ر.ي";
function dateInYemen(d: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Aden", day: "2-digit", month: "2-digit", year: "numeric" }).format(d); }
function financeDates() { const now = new Date(); const start = new Date(now); start.setUTCDate(now.getUTCDate() - 29); return { from: dateInYemen(start), to: dateInYemen(now) }; }
const range = financeDates();

function Glyph({ name, size = 18 }: Readonly<{ name: string; size?: number }>) {
  const shared = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "wallet") return <svg {...shared}><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18M5 6V4a2 2 0 0 1 2-2h11"/><rect x="15" y="12" width="6" height="5" rx="1"/></svg>;
  if (name === "dashboard") return <svg {...shared}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>;
  if (name === "users") return <svg {...shared}><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6m1 5a5 5 0 0 1 3 5"/></svg>;
  if (name === "store") return <svg {...shared}><path d="M3 10l2-7h14l2 7M3 10v11h18V10M3 10c0 3 4 3 4 0 0 3 4 3 4 0 0 3 4 3 4 0 0 3 4 3 4 0M9 21v-7h6v7"/></svg>;
  if (name === "truck") return <svg {...shared}><path d="M3 7h11v10H3zM14 10h4l3 4v3h-7M5 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0"/></svg>;
  if (name === "user") return <svg {...shared}><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>;
  if (name === "scale") return <svg {...shared}><path d="M12 3v18M4 7h16M7 7l-4 8h8L7 7Zm10 0-4 8h8l-4-8ZM7 21h10"/></svg>;
  if (name === "chart") return <svg {...shared}><path d="M3 18l5-6 4 2 7-9M3 3v18h18"/></svg>;
  if (name === "activity") return <svg {...shared}><path d="M2 12h5l3-7 4 14 3-7h5"/></svg>;
  if (name === "inbox") return <svg {...shared}><path d="M4 4h16v16H4zM4 13h5l2 3h2l2-3h5"/></svg>;
  if (name === "transfer") return <svg {...shared}><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></svg>;
  if (name === "clock") return <svg {...shared}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "search") return <svg {...shared}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;
  if (name === "filter") return <svg {...shared}><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/></svg>;
  if (name === "check") return <svg {...shared}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v2h6V3m-7 10 2 2 5-5"/></svg>;
  if (name === "layers") return <svg {...shared}><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === "calendar") return <svg {...shared}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 10h18"/></svg>;
  if (name === "download") return <svg {...shared}><path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/></svg>;
  if (name === "chevron") return <svg {...shared}><path d="m9 6 6 6-6 6"/></svg>;
  return <svg {...shared}><circle cx="12" cy="12" r="9"/><path d="M12 7v5"/></svg>;
}
function TinySparkline({ color, values }: { color: string; values: readonly number[] }) {
  if (values.every(value => value === 0)) return <span className="fr-spark-empty" aria-label="لا توجد سلسلة زمنية">—</span>;
  const min = Math.min(...values, 0), max = Math.max(...values, 1);
  const points = values.map((v, i) => String(i * 15) + "," + String(34 - 27 * (v - min) / (max - min))).join(" ");
  return <svg className="fr-spark" viewBox="0 0 105 40" aria-hidden="true"><polyline points={points} stroke={color} strokeWidth="1.7" fill="none"/><path d={"M" + points.replaceAll(" ", " L") + " L105 40 L0 40Z"} fill={color} opacity=".07"/></svg>;
}
function WalletDonut({ groups, total }: { groups: readonly WalletGroup[]; total: number }) {
  let offset = 0;
  const stops = groups.map((group, i) => {
    const end = offset + (total ? Math.max(0, group.amount) / total * 100 : 0);
    const stop = groupDefinitions[i]!.color + " " + offset + "% " + end + "%";
    offset = end; return stop;
  });
  return <div className="fr-donut" style={{ background: total ? "conic-gradient(" + stops.join(",") + ")" : "conic-gradient(#1a2a40 0% 100%)" }}>
    <div className="fr-donut-center"><strong>{total ? riyals(total) : "—"}</strong><span>ر.ي</span></div>
  </div>;
}
function MovementGraph({ rows }: { rows: readonly FinanceReferenceRow[] }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 6 + i);
    const key = dateInYemen(d);
    const matches = rows.filter((row) => row.source === "custody" && row.date?.startsWith(key));
    return { day: new Intl.DateTimeFormat("ar-YE", { day: "numeric", month: "short", timeZone: "Asia/Aden" }).format(d), amount: matches.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0) / 100 };
  }), [rows]);
  const max = Math.max(...days.map((day) => day.amount), 1);
  if (days.every(day => day.amount === 0)) return <div className="fr-graph-empty">لا توجد تحصيلات يومية مؤرخة ضمن السجلات المحمّلة. افتح سجل التحصيل للتحقق من كامل البيانات.</div>;
  return <div className="fr-graph-body">
    <div className="fr-chart-legend"><span><i style={{ background: "#238bff" }}/>تحصيل COD في السجلات المحملة</span></div>
    <div className="fr-graph-grid">
      <div className="fr-yaxis">{[4,3,2,1,0].map((n) => <span key={n}>{number(Math.round(max * n / 4))}</span>)}</div>
      <div className="fr-plot">
        <div className="fr-grid-lines">{[0,1,2,3,4].map(n => <span key={n}/>)}</div>
        <div className="fr-plot-bars">{days.map((day,i) => <div className="fr-plot-day" key={i} title={day.day + ": " + number(day.amount) + " ر.ي"}>
          <span className="fr-plot-bar" style={{ height: (day.amount ? Math.max(day.amount / max * 100, 4) : 1) + "%" }}/>
          <small>{day.day}</small>
        </div>)}</div>
      </div>
    </div>
    <span className="fr-graph-disclaimer">المخطط من التحصيلات المحملة فقط، وليس إجمالي حركة المحافظ.</span>
  </div>;
}
function downloadCSV(rows: readonly FinanceReferenceRow[]) {
  const lines = [["الأولوية","النوع","المستفيد","المرجع","الحالة","المبلغ","الإجراء"].join(","), ...rows.map(row => [row.priority, row.category, row.subject, row.reference, row.state, row.amount, row.nextStep].map(value => '"' + String(value).replaceAll('"','""') + '"').join(","))];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "bthwani-finance-loaded-rows.csv"; link.click(); URL.revokeObjectURL(url);
}
export function FinanceReferenceDashboard({ rows, errors, hasData, hasMore, onOpenWorkflow }: Readonly<{
  rows: readonly FinanceReferenceRow[]; errors: readonly string[]; hasData: boolean; hasMore: boolean;
  onOpenWorkflow: (workflow: FinanceReferenceWorkflow, row: FinanceReferenceRow | null) => void;
}>) {
  const [tab, setTab] = useState<FinanceReferenceTab>("command");
  const [walletGroups, setWalletGroups] = useState<readonly WalletGroup[]>(emptyGroups);
  const [intakes, setIntakes] = useState<readonly Intake[]>([]);
  const [intakeError, setIntakeError] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(1);
  const [showIntakes, setShowIntakes] = useState(false);
  const [walletMetric, setWalletMetric] = useState<"balance" | "count">("balance");
  const [walletDays, setWalletDays] = useState("30");
  const [dateRange, setDateRange] = useState(range);
  const [walletLoading, setWalletLoading] = useState(true);

  useEffect(() => {
    let active = true; const controller = new AbortController();
    setWalletLoading(true);
    const run = async () => {
      const requests = groupDefinitions.map(async (group): Promise<WalletGroup> => {
        try {
          const query = new URLSearchParams({ actorType: group.type, from: dateRange.from, to: dateRange.to });
          const response = await fetch("/api/finance/financial-statements?" + query, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const body: WalletRegistry = await response.json();
          if (!Array.isArray(body.summaries)) throw new Error("INVALID_RESPONSE");
          return { type: group.type, name: group.name, amount: body.summaries.reduce((sum,w)=>sum+w.currentBalanceMinor,0), count: body.summaries.length, loaded: true, complete: !body.nextCursor };
        } catch (cause) { return { type: group.type, name: group.name, amount: 0, count: 0, loaded: false, complete: false, error: cause instanceof Error ? cause.message : "ERROR" }; }
      });
      const result = await Promise.all(requests);
      if (active) { setWalletGroups(result); setWalletLoading(false); }
    };
    void run(); return () => { active = false; controller.abort(); };
  }, [dateRange]);
  const loadIntakes = useCallback(async () => {
    try {
      const response = await fetch("/api/finance/settlement-intakes", { cache: "no-store" });
      if (!response.ok) throw new Error("UNAVAILABLE");
      const result = await response.json() as { intakes?: readonly Intake[] };
      if (!Array.isArray(result.intakes)) throw new Error("INVALID_DATA");
      setIntakes(result.intakes); setIntakeError(false);
    } catch { setIntakeError(true); }
  }, []);
  useEffect(() => { void loadIntakes(); }, [loadIntakes]);

  const walletTotal = walletGroups.filter(x=>x.loaded).reduce((sum,x)=>sum+x.amount,0);
  const walletCount = walletGroups.filter(x=>x.loaded).reduce((sum,x)=>sum+x.count,0);
  const walletComplete = walletGroups.every(x=>x.loaded && x.complete);
  const amountBy = (source: string) => rows.filter(r=>r.source===source).reduce((sum,r)=>sum+(r.amountMinor??0),0);
  const amountKnown = (source: string) => rows.some(r=>r.source===source && typeof r.amountMinor === "number");
  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("ar");
    const intakeRows: FinanceReferenceRow[] = intakes.map(item=>({ key: "intake:"+item.id, id:item.id, source:"batches", subject: (item.actorType==="field"?"ميداني":item.actorType==="captain"?"كابتن":"شريك")+" · "+item.actorId, reference: item.id, category:"طلب تسوية", state:"بانتظار مراجعة جهة الصرف", amount:displayMoney(item.resolvedAmountMinor), amountMinor:item.resolvedAmountMinor, priority:1, nextStep:"مراجعة جهة الصرف", date:item.createdAt }));
    const all = [...intakeRows,...rows];
    return all.filter(row => {
      if (tab === "collection" && !["custody","commissions"].includes(row.source)) return false;
      if (tab === "settlements" && !["batches","withdrawals"].includes(row.source)) return false;
      if (tab === "reconcile" && !["batches","custody"].includes(row.source)) return false;
      if (tab === "pending" && row.priority > 2) return false;
      if (type !== "all" && row.source !== type) return false;
      if (priority !== "all" && (priority==="urgent" ? row.priority!==1 : priority==="high" ? row.priority>2 : row.priority<=2)) return false;
      return !normalized || [row.subject,row.reference,row.category,row.state,row.amount,row.nextStep].some(v=>v.toLocaleLowerCase("ar").includes(normalized));
    }).sort((a,b)=>a.priority-b.priority || (a.date??"").localeCompare(b.date??""));
  }, [tab, intakes, rows, search, type, priority]);
  const pageCount = Math.max(1,Math.ceil(filtered.length/6));
  const shown = filtered.slice((Math.min(page,pageCount)-1)*6,Math.min(page,pageCount)*6);
  const navTo = (next: FinanceReferenceTab) => { setTab(next); setPage(1); setSearch(""); setPriority("all"); setType("all"); };
  const kpis = [
    { label:"إجمالي أرصدة المحافظ", value:walletLoading?"…":walletGroups.some(x=>x.loaded)?displayMoney(walletTotal):"—", sub:walletComplete?"الرصيد الدفتري الحالي":"من المحافظ المحمّلة فقط", icon:"layers",color:"#06d5a0" },
    { label:"قرارات تحتاج إجراء", value: hasData && !intakeError ? number(rows.filter(r=>r.priority<=2).length+intakes.length) : "—", sub:"من السجلات المتاحة", icon:"check",color:"#ef6667" },
    { label:"مستحقات للصرف", value:amountKnown("batches")?riyals(amountBy("batches")):"—",sub:"دفعات التحويل المعروضة · ر.ي",icon:"wallet",color:"#f2ac3c" },
    { label:"تحصيلات قيد المتابعة", value:amountKnown("custody")?riyals(amountBy("custody")):"—",sub:"تحصيلات COD المعروضة · ر.ي",icon:"layers",color:"#13cfa0" },
    { label:"فروقات المطابقة", value:"—",sub:"لا يتوفر إجمالي معتمد",icon:"scale",color:"#f06972" },
  ];
  return <div className="fr-dashboard" dir="rtl">
    <div className="fr-masthead">
      <div className="fr-mast-title"><span className="fr-mark" aria-hidden="true"><b/><b/><b/></span><div><h1>المركز المالي</h1><p>الصورة المالية الكاملة لمنصة بثواني</p></div></div>
      <div className="fr-mast-tools">
        <label className="fr-period"><Glyph name="calendar" size={17}/><span>الفترة</span><select aria-label="الفترة الزمنية" value={walletDays} onChange={e=>{setWalletDays(e.target.value);const to=new Date();const from=new Date(to);from.setUTCDate(to.getUTCDate()-Number(e.target.value)+1);setDateRange({from:dateInYemen(from),to:dateInYemen(to)});}}><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option></select></label>
        <div className="fr-data-status" title="الأرصدة من سجلات WLT المحمّلة"><i/><div><strong>{walletLoading?"جارٍ التحديث":walletGroups.every(x=>x.loaded)?"البيانات محدثة":"بعض المصادر غير متاحة"}</strong><small>من المصدر المالي</small></div></div>
      </div>
    </div>
    <nav className="fr-tabs" aria-label="أقسام المركز المالي">{tabs.map(t=><button type="button" key={t.key} aria-current={tab===t.key?"page":undefined} onClick={()=>navTo(t.key)}><Glyph name={t.icon} size={16}/>{t.label}</button>)}</nav>
    {tab==="wallets" ? <div className="fr-wallet-registry"><FinanceWalletRegistry /></div> : <>
      <div className="fr-kpis">{kpis.map(k=><div className="fr-kpi" key={k.label}><div className="fr-kpi-heading"><span>{k.label}</span><span className="fr-kpi-glyph" style={{color:k.color,background:k.color+"16"}}><Glyph name={k.icon} size={23}/></span></div><strong dir="ltr">{k.value}</strong><div className="fr-kpi-end"><small>{k.sub}</small><TinySparkline color={k.color} values={[0,0,0,0,0,0,0,0]}/></div></div>)}</div>
      <div className="fr-analysis">
        <section className="fr-analysis-card fr-sector-card">
          <div className="fr-card-heading"><h2>توزيع الأرصدة حسب الأطراف</h2><span className="fr-chip">من المحافظ المحمّلة</span></div>
          <div className="fr-sectors">{groupDefinitions.map((g,i)=><div className="fr-sector" key={g.type}><span className="fr-sector-name"><Glyph name={g.icon} size={15}/>{g.name}</span><span className="fr-sector-bar"><i style={{width:(walletTotal?Math.max(0,(walletGroups[i] ?? emptyGroups[i]!).amount/walletTotal*100):0)+"%",background:g.color}}/></span><span className="fr-sector-amount" dir="ltr">{(walletGroups[i] ?? emptyGroups[i]!).loaded?riyals((walletGroups[i] ?? emptyGroups[i]!).amount):"—"}</span><small>{walletTotal&&(walletGroups[i] ?? emptyGroups[i]!).loaded?Math.round((walletGroups[i] ?? emptyGroups[i]!).amount/walletTotal*100)+"%":"—"}</small></div>)}</div>
        </section>
        <section className="fr-analysis-card fr-movement-card"><div className="fr-card-heading"><h2>حركة التحصيل خلال آخر 7 أيام</h2><span className="fr-chip">السجلات المتاحة</span></div><MovementGraph rows={rows}/></section>
        <section className="fr-analysis-card fr-donut-card"><div className="fr-card-heading"><h2>توزيع أرصدة المحافظ</h2><div className="fr-toggle"><button type="button" aria-pressed={walletMetric==="balance"} onClick={()=>setWalletMetric("balance")}>الرصيد</button><button type="button" aria-pressed={walletMetric==="count"} onClick={()=>setWalletMetric("count")}>عدد المحافظ</button></div></div><div className="fr-donut-area"><WalletDonut groups={walletMetric==="balance"?walletGroups:walletGroups.map(g=>({...g,amount:g.count}))} total={walletMetric==="balance"?walletTotal:walletCount}/><div className="fr-donut-legend">{groupDefinitions.map((group,i)=><div key={group.type}><i style={{background:group.color}}/><span>{group.name}</span><strong dir="ltr">{(walletGroups[i] ?? emptyGroups[i]!).loaded?walletMetric==="balance"?riyals((walletGroups[i] ?? emptyGroups[i]!).amount):number((walletGroups[i] ?? emptyGroups[i]!).count):"—"}</strong></div>)}</div></div>{!walletComplete?<p className="fr-annotation">المجموع من المحافظ المسترجعة فقط، وليس إجمالي دفتر المنصة.</p>:null}</section>
      </div>
      {errors.length>0||intakeError ? <div className="fr-source-warning" role="alert">بعض البيانات المالية غير متاحة. {errors.join("، ")} {intakeError?"· تعذرت قراءة التسويات":""}</div>:null}
      <div className="fr-lower">
        <aside className="fr-wallet-aside"><div className="fr-aside-title"><h2>ملخص المحافظ</h2><button type="button" onClick={()=>navTo("wallets")}>عرض الكل</button></div><div className="fr-wallet-cards">{groupDefinitions.map((group,i)=><button type="button" className="fr-wallet-mini" key={group.type} onClick={()=>navTo("wallets")} style={{"--group-color":group.color} as React.CSSProperties}><span className="fr-mini-icon"><Glyph name={group.icon} size={22}/></span><span><strong>{group.name}</strong><b dir="ltr">{(walletGroups[i] ?? emptyGroups[i]!).loaded?displayMoney((walletGroups[i] ?? emptyGroups[i]!).amount):"—"}</b><small>{(walletGroups[i] ?? emptyGroups[i]!).loaded?number((walletGroups[i] ?? emptyGroups[i]!).count)+" محفظة محملة":"لا تتوفر بيانات"}</small></span></button>)}</div></aside>
        <section className="fr-transactions"><div className="fr-table-top"><div className="fr-table-tags"><button type="button" className={tab==="command"?"active":""} onClick={()=>navTo("command")}>القرارات التي تحتاج إجراء <b>{rows.filter(r=>r.priority<=2).length+intakes.length}</b></button><button type="button" className={tab==="settlements"?"active":""} onClick={()=>navTo("settlements")}>طلبات الصرف <b>{rows.filter(r=>r.source==="batches"||r.source==="withdrawals").length}</b></button><button type="button" className={tab==="collection"?"active":""} onClick={()=>navTo("collection")}>التحصيلات <b>{rows.filter(r=>r.source==="custody").length}</b></button><button type="button" className={tab==="reconcile"?"active":""} onClick={()=>navTo("reconcile")}>المطابقة</button></div><div className="fr-table-actions"><button type="button" onClick={()=>downloadCSV(filtered)}><Glyph name="download" size={14}/>تصدير</button><button type="button" onClick={()=>setShowIntakes(v=>!v)} aria-expanded={showIntakes}>طلبات التسوية</button></div></div>
          <div className="fr-table-filters"><label className="fr-finance-search"><Glyph name="search" size={16}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="بحث في السجلات المحمّلة..." aria-label="بحث في السجلات المحمّلة"/></label><select aria-label="نوع المصدر" value={type} onChange={e=>{setType(e.target.value);setPage(1)}}><option value="all">جميع المصادر</option><option value="custody">التحصيل النقدي</option><option value="commissions">ذمم العمولة</option><option value="batches">التسويات</option><option value="withdrawals">سحوبات العملاء</option></select><select aria-label="الأولوية" value={priority} onChange={e=>{setPriority(e.target.value);setPage(1)}}><option value="all">كل الحالات</option><option value="urgent">عاجلة</option><option value="high">عاجلة وعالية</option><option value="normal">متابعة</option></select><button type="button" title="إظهار الحالات المعلقة" onClick={()=>navTo("pending")}><Glyph name="filter" size={18}/></button></div>
          {showIntakes ? <div className="fr-intake-layer"><div className="fr-intake-head"><h3>طلبات التسوية ومراجعة الصرف</h3><button type="button" onClick={()=>{setShowIntakes(false);void loadIntakes()}}>إغلاق</button></div><SettlementIntakeInbox visible /></div> : null}
          <div className="fr-table-scroll"><table><thead><tr><th>الأولوية</th><th>نوع الحالة</th><th>المبلغ</th><th>المستفيد</th><th>السبب</th><th>المدة</th><th>المرجع</th><th>الإجراء</th></tr></thead><tbody>{shown.map(row=><tr key={row.key}><td><span className={"fr-priority p"+row.priority}>{row.priority===1?"حرجة":row.priority===2?"عالية":"عادية"}</span></td><td>{row.category}</td><td dir="ltr">{row.amount}</td><td className="fr-subject">{row.subject}</td><td className="fr-reason">{row.nextStep}</td><td>{row.date?new Intl.DateTimeFormat("ar-YE",{day:"numeric",month:"short",timeZone:"Asia/Aden"}).format(new Date(row.date)):"—"}</td><td className="fr-reference" dir="auto">{row.reference}</td><td><button type="button" className="fr-row-action" onClick={()=>{if(row.key.startsWith("intake:")){setShowIntakes(true)}else onOpenWorkflow(row.source==="batches"?"batches":row.source,row)}}>إجراء</button></td></tr>)}</tbody></table>
            {shown.length===0?<div className="fr-empty">{hasData?"لا توجد حركات مطابقة ضمن البيانات المحمّلة.":"جارٍ جلب السجلات المالية…"}</div>:null}
          </div><div className="fr-table-foot"><span>{filtered.length?number((Math.min(page,pageCount)-1)*6+1)+"–"+number(Math.min(page*6,filtered.length))+" من "+number(filtered.length):"لا توجد سجلات"} {hasMore?"· بعض المصادر بها صفحات أخرى":""}</span><div className="fr-pages"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><Glyph name="chevron" size={13}/></button>{Array.from({length:Math.min(pageCount,5)},(_,i)=><button key={i} type="button" aria-current={page===i+1?"page":undefined} onClick={()=>setPage(i+1)}>{i+1}</button>)}<button type="button" disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)}><Glyph name="chevron" size={13}/></button></div></div>
        </section>
      </div>
      {tab!=="command" ? <div className="fr-context-links">{(tab==="settlements"?["settlement-partner","settlement-captain","settlement-field","batches","withdrawals"]:tab==="collection"?["custody","commissions"]:tab==="reconcile"?["batches","custody","commissions"]:["custody","commissions","batches","withdrawals"]).map(w=><button key={w} type="button" onClick={()=>onOpenWorkflow(w as FinanceReferenceWorkflow,null)}>{workflowLabels[w as FinanceReferenceWorkflow]} ←</button>)}</div>:null}
      <p className="fr-integrity-note">مؤشرات هذه الشاشة محسوبة من البيانات المحمّلة؛ ليست أرصدة مدققة لكامل المنصة. الإجراءات الحساسة داخل سجلاتها المعتمدة.</p>
    </>}
  </div>;
}
// Leave the numeric formatting localized to the dashboard; the screenshot's values are not hardcoded.
function riyalsFallback(value: number) { return riyals(value); }
