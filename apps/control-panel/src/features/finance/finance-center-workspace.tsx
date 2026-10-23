"use client";

import {
  type CashCustodyRegistryResponse,
  type CustomerWithdrawalIntakeListResponse,
  formatMoney,
  type PartnerCommissionReceivableRegistryResponse,
  type SettlementBatch,
} from "@bthwani/dsh";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { FinanceWalletRegistry } from "./finance-wallet-registry";
import "./finance-command-center.css";
import { PageHeader } from "../../shell/page-header";
import { SettlementIntakeInbox } from "./settlement-intake-inbox";
import { useReadOnReturn } from "../shared/use-read-on-return";

const CashCustodyWorkspace = dynamic(() => import("./cash-custody-workspace").then((module) => module.CashCustodyWorkspace));
const PartnerEarningsWorkspace = dynamic(() => import("./partner-earnings-workspace").then((module) => module.PartnerEarningsWorkspace));
const CustomerWithdrawalQueue = dynamic(() => import("./customer-withdrawal-queue").then((module) => module.CustomerWithdrawalQueue));
const BeneficiarySettlementWorkspace = dynamic(() => import("./beneficiary-settlement-workspace").then((module) => module.BeneficiarySettlementWorkspace));
const StoreCommercialAgreementWorkspace = dynamic(() => import("./store-commercial-agreement-workspace").then((module) => module.StoreCommercialAgreementWorkspace));
const StoreTypeCommissionDefaultWorkspace = dynamic(() => import("./store-type-commission-default-workspace").then((module) => module.StoreTypeCommissionDefaultWorkspace));

type Source = "custody" | "commissions" | "batches" | "withdrawals";
type Workflow = "custody" | "commissions" | "batches" | "withdrawals" | "settlement-partner" | "settlement-captain" | "settlement-field" | "agreements";
type FinancialRow = Readonly<{
  key: string;
  source: Source;
  id: string;
  subject: string;
  reference: string;
  category: string;
  state: string;
  amount: string;
  nextStep: string;
  priority: number;
  date?: string;
}>;
type ReadResult = Readonly<{ items: readonly FinancialRow[]; hasMore: boolean; error?: string }>;
type QueueDefinition = Readonly<{ source: Source; label: string; endpoint: string }>;
type InitialQuery = Record<string, string | string[] | undefined>;

const sources: readonly QueueDefinition[] = [
  { source: "custody", label: "التحصيل النقدي", endpoint: "/api/finance/cash-custody?limit=25&sort=collected_asc" },
  { source: "commissions", label: "ذمم عمولة المنصة", endpoint: "/api/finance/partner-commission-receivables?limit=25&sort=actor_asc" },
  { source: "batches", label: "دفعات تنتظر الاعتماد", endpoint: "/api/finance/settlement-batches?limit=25&status=PREPARED" },
  { source: "withdrawals", label: "سحوبات العملاء", endpoint: "/api/finance/customer-withdrawal-intakes?limit=25&status=REQUESTED&sort=requested_asc" },
];
const sourceLabels: Record<Source, string> = {
  custody: "التحصيل النقدي",
  commissions: "ذمم عمولة المنصة",
  batches: "دفعات التحويل",
  withdrawals: "سحوبات العملاء",
};
const workflowLabels: Record<Workflow, string> = {
  custody: "التحصيل النقدي والتوريدات",
  commissions: "ذمم عمولة المنصة والتحصيل",
  batches: "دفعات التحويل والمطابقة",
  withdrawals: "سحوبات العملاء الاستثنائية",
  "settlement-partner": "مستحقات الشركاء",
  "settlement-captain": "مستحقات الكباتن",
  "settlement-field": "مستحقات الميدانيين",
  agreements: "اتفاقات المتاجر",
};

function queryValue(query: InitialQuery, key: string): string {
  const value = query[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function parseWorkflow(value: string): Workflow | null {
  return Object.hasOwn(workflowLabels, value) ? value as Workflow : null;
}
function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
function safeArray(body: unknown, key: string): readonly unknown[] {
  if (!body || typeof body !== "object") throw new Error("استجابة مالية غير صالحة");
  const items = (body as Record<string, unknown>)[key];
  if (!Array.isArray(items)) throw new Error("قائمة السجلات المالية غير صالحة");
  return items;
}
function safeMore(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { nextCursor?: unknown }).nextCursor);
}
function financialRows(source: Source, body: unknown): readonly FinancialRow[] {
  safeArray(body, source === "batches" ? "batches" : source === "withdrawals" ? "intakes" : "items");
  if (source === "custody") {
    return (body as CashCustodyRegistryResponse).items.map((item) => {
      const pending = item.remittanceState === "SUBMITTED";
      return {
        source, key: source + ":" + item.paymentIntentId, id: item.paymentIntentId,
        subject: safeText((item as typeof item & { captainName?: string }).captainName, "كابتن بثواني"),
        reference: item.externalReference, category: "تحصيل نقدي",
        state: pending ? "توريد بانتظار المطابقة" : "بانتظار توريد الكابتن",
        nextStep: pending ? "مراجعة الإيصال ومطابقة التوريد" : "متابعة توريد الكابتن",
        amount: formatMoney(item.amountMinor, item.currency), priority: pending ? 1 : 4,
        date: item.collectedAt,
      };
    });
  }
  if (source === "commissions") {
    return (body as PartnerCommissionReceivableRegistryResponse).items.map((item) => ({
      source, key: source + ":" + item.partnerActorId, id: item.partnerActorId,
      subject: safeText(item.businessName, "شريك بثواني"), reference: "شريك · " + item.partnerActorId,
      category: "عمولة منصة", state: "ذمة مستحقة",
      nextStep: "مراجعة المستحق وإثبات التوريد المتحقق منه",
      amount: formatMoney(item.outstandingCommissionReceivableMinor, item.currency),
      priority: item.outstandingCommissionReceivableMinor > 0 ? 2 : 5,
    }));
  }
  if (source === "batches") {
    return (body as { batches: readonly SettlementBatch[] }).batches.map((item) => ({
      source, key: source + ":" + item.id, id: item.id,
      subject: "دفعة من " + item.rowCount.toLocaleString("ar-YE") + " تحويل",
      reference: "دفعة · " + item.id, category: "تسوية مالية",
      state: "بانتظار الاعتماد", nextStep: "مراجعة الدفعة واعتمادها وفق الصلاحية",
      amount: formatMoney(item.totalAmountMinor, item.currency), priority: 1,
    }));
  }
  return (body as CustomerWithdrawalIntakeListResponse).intakes.map((item) => ({
    source, key: source + ":" + item.id, id: item.id,
    subject: safeText(item.beneficiaryName, "عميل بثواني"),
    reference: "طلب سحب · " + item.id, category: "سحب استثنائي",
    state: "طلب جديد", nextStep: "التحقق من الطلب ووجهة الصرف",
    amount: "يظهر المبلغ في تفاصيل الطلب", priority: 1,
  }));
}

function workflowFor(row: FinancialRow): Workflow {
  return row.source === "batches" ? "batches" : row.source;
}

function FinanceTask({
  workflow, row, query,
}: Readonly<{ workflow: Workflow; row: FinancialRow | null; query: InitialQuery }>) {
  const search = queryValue(query, "search").trim().slice(0, 128);
  const cursor = queryValue(query, "cursor").slice(0, 1024);
  if (workflow === "custody") return <CashCustodyWorkspace initialQuery={{
    search: search || (row?.source === "custody" ? row.reference : ""),
    sort: queryValue(query, "sort") === "collected_desc" ? "collected_desc" : "collected_asc", cursor,
  }} />;
  if (workflow === "commissions") return <PartnerEarningsWorkspace initialQuery={{
    cursor, partnerActorId: queryValue(query, "partnerActorId") || (row?.source === "commissions" ? row.id : ""),
  }} />;
  if (workflow === "withdrawals") return <CustomerWithdrawalQueue initialQuery={{
    status: queryValue(query, "status") || "REQUESTED",
    search, sort: queryValue(query, "sort") === "requested_asc" ? "requested_asc" : "requested_desc",
    cursor, intakeId: queryValue(query, "intakeId") || (row?.source === "withdrawals" ? row.id : ""),
  }} />;
  if (workflow === "agreements") return <div className="finance-center-tools">
    <StoreTypeCommissionDefaultWorkspace />
    <StoreCommercialAgreementWorkspace />
  </div>;
  const actorType = workflow === "settlement-captain" ? "captain" : workflow === "settlement-field" ? "field" : "partner";
  const view = workflow === "batches" ? "batches" : ["beneficiaries", "batches", "reconciliation"].includes(queryValue(query, "view"))
    ? queryValue(query, "view") as "beneficiaries" | "batches" | "reconciliation" : "beneficiaries";
  return <BeneficiarySettlementWorkspace actorType={actorType} initialQuery={{
    status: "" as const, search, admissionState: "all",
    sort: "available_desc", cursor, view, batchId: row?.source === "batches" ? row.id : queryValue(query, "batchId"),
    batchStatus: workflow === "batches" ? "PREPARED" : queryValue(query, "batchStatus"),
    batchCursor: queryValue(query, "batchCursor"),
  }} />;
}

export function FinanceCenterWorkspace({ initialQuery = {} }: Readonly<{ initialQuery?: InitialQuery }>) {
  const router = useRouter();
  const { state } = useSession();
  const actor = state.kind === "authenticated" && state.identity.role === "operator" && state.identity.permissions?.includes("finance")
    ? state.identity.subject : null;
  const [snapshot, setSnapshot] = useState<{ actor: string; results: Partial<Record<Source, ReadResult>> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"command" | "wallets" | "activity" | "collection" | "settlements" | "reconcile">("command");
  const [search, setSearch] = useState("");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [intakeCount, setIntakeCount] = useState<number | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(() => parseWorkflow(queryValue(initialQuery, "workflow")));
  const [activeRow, setActiveRow] = useState<FinancialRow | null>(null);
  const sequence = useRef(0);
  const visible = actor && snapshot?.actor === actor ? snapshot.results : null;

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!actor) { setSnapshot(null); return; }
    setLoading(true);
    const results = await Promise.all(sources.map(async (source) => {
      try {
        const response = await fetch(source.endpoint, { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error("تعذرت قراءة " + source.label + " (" + response.status + ")");
        const body: unknown = await response.json();
        return [source.source, { items: financialRows(source.source, body), hasMore: safeMore(body) }] as const;
      } catch (cause) {
        return [source.source, { items: [], hasMore: false, error: cause instanceof Error ? cause.message : "تعذر تحميل السجل" }] as const;
      }
    }));
    if (request !== sequence.current) return;
    setSnapshot({ actor, results: Object.fromEntries(results) });
    setLoading(false);
  }, [actor]);
  useEffect(() => {
    void refresh();
    return () => { sequence.current += 1; };
  }, [refresh]);
  useReadOnReturn(refresh, Boolean(actor) && !loading && !activeWorkflow);
  const rows = useMemo(() => sources.flatMap((source) => visible?.[source.source]?.items ?? [])
    .sort((a, b) => a.priority - b.priority || (a.date ?? "").localeCompare(b.date ?? "") || a.key.localeCompare(b.key)), [visible]);
  const errors = sources.filter((source) => Boolean(visible?.[source.source]?.error));
  const more = sources.filter((source) => visible?.[source.source]?.hasMore);
  const matched = rows.filter((row) =>
    (sourceFilter === "all" || row.source === sourceFilter) &&
    (!priorityOnly || row.priority <= 2) &&
    [row.subject, row.reference, row.category, row.state, row.nextStep, row.amount].some((value) => value.toLocaleLowerCase("ar").includes(search.trim().toLocaleLowerCase("ar"))));
  const displayedRows = tab === "command" ? matched.filter((row) => row.priority <= 2) : matched;
  const selected = displayedRows.find((row) => row.key === focusedKey) ?? displayedRows[0] ?? null;
  const hasData = Boolean(visible);
  const counts = { custody: visible?.custody?.items.length ?? 0, commissions: visible?.commissions?.items.length ?? 0, batches: visible?.batches?.items.length ?? 0, withdrawals: visible?.withdrawals?.items.length ?? 0 };
  const attentionCount = rows.filter((row) => row.priority <= 2).length + (intakeCount ?? 0);
  const tabs = [
    { id: "command", label: "القيادة", icon: "⌁" },
    { id: "wallets", label: "المحافظ", icon: "▣" },
    { id: "activity", label: "الحركات", icon: "⇄" },
    { id: "collection", label: "التحصيل", icon: "↓" },
    { id: "settlements", label: "التسويات", icon: "✓" },
    { id: "reconcile", label: "المطابقة", icon: "≋" },
  ] as const;
  const openTask = (workflow: Workflow, row: FinancialRow | null = null) => { setActiveRow(row); setActiveWorkflow(workflow); };
  const closeTask = () => {
    if (Object.keys(initialQuery).length) router.replace("/finance", { scroll: false });
    setActiveWorkflow(null); setActiveRow(null); void refresh();
  };
  const changeTab = (next: typeof tab) => { setTab(next); setFocusedKey(null); setSearch(""); setSourceFilter("all"); setPriorityOnly(false); };
  if (state.kind !== "authenticated") return null;
  if (!actor) return <section className="state-content workspace-restricted" role="alert"><h1>صلاحية المالية غير متاحة</h1><p>يتطلب عرض الأرصدة والكشوف إذن المالية.</p></section>;

  return <section className="workspace-page finance-center fc-shell" aria-labelledby="finance-center-title">
    <PageHeader id="finance-center-title" title="المركز المالي" actions={activeWorkflow
      ? <button type="button" className="button button-secondary" onClick={closeTask}>العودة إلى المركز المالي</button>
      : errors.length ? <button type="button" className="button button-secondary" disabled={loading} onClick={() => void refresh()}>إعادة قراءة المصادر</button> : undefined} />
    {activeWorkflow ? <div className="finance-center-active">
      <div className="finance-center-active-header"><div><h2>{workflowLabels[activeWorkflow]}</h2><p className="muted">التفاصيل والتفويض والإجراءات من سجلاتها الأصلية.</p></div>
        <button className="fc-btn" type="button" onClick={closeTask}>إغلاق التفاصيل ×</button></div>
      <FinanceTask workflow={activeWorkflow} row={activeRow} query={initialQuery} />
    </div> : <>
      <div className="fc-topline"><span>قيادة العمليات المالية · المحافظ والحركات والتحصيل والتسويات</span><span className="fc-live"><i /> من المصادر المعتمدة</span></div>
      <nav className="fc-main-tabs" aria-label="أقسام المركز المالي">
        {tabs.map((item) => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} onClick={() => changeTab(item.id)}>
          <span aria-hidden="true">{item.icon}</span>{item.label}
        </button>)}
      </nav>
      {tab === "wallets" ? <FinanceWalletRegistry /> : <>
        <div className="fc-kpis" aria-label="مؤشرات المعاينة المالية">
          {[
            { label: "قرارات تحتاج انتباهًا", value: intakeCount === null || !hasData ? "—" : attentionCount.toLocaleString("ar-YE"), note: "ضمن السجلات المحمّلة", kind: "critical", icon: "!" },
            { label: "دفعات تنتظر الاعتماد", value: hasData ? counts.batches.toLocaleString("ar-YE") : "—", note: "من معاينة دفعات التحويل", kind: "warning", icon: "◷" },
            { label: "ذمم عمولات للمتابعة", value: hasData ? counts.commissions.toLocaleString("ar-YE") : "—", note: "سجل ذمم الشركاء", kind: "neutral", icon: "⇄" },
            { label: "تحصيلات نقدية", value: hasData ? counts.custody.toLocaleString("ar-YE") : "—", note: "من سجل التحصيل المحمّل", kind: "success", icon: "▣" },
            { label: "طلبات سحب استثنائية", value: hasData ? counts.withdrawals.toLocaleString("ar-YE") : "—", note: "ضمن طلبات السحب الجديدة", kind: "neutral", icon: "↗" },
          ].map((metric) => <div className="fc-kpi" data-kind={metric.kind} key={metric.label}>
            <div className="fc-kpi-top"><span>{metric.label}</span><span className="fc-kpi-icon" aria-hidden="true">{metric.icon}</span></div>
            <strong>{metric.value}</strong><small>{metric.note}</small>
          </div>)}
        </div>
        {errors.length ? <div className="fc-warning" role="alert">تعذر تحميل {errors.length.toLocaleString("ar-YE")} من المصادر: {errors.map((item) => item.label).join("، ")}. البيانات المعروضة جزئية.</div> : null}
        {tab !== "command" ? <div className="fc-workflow-links" aria-label="السجلات التشغيلية المتاحة">
          {(tab === "collection" ? (["custody", "commissions"] as Workflow[])
            : tab === "settlements" ? (["settlement-partner", "settlement-captain", "settlement-field", "withdrawals", "batches"] as Workflow[])
            : tab === "reconcile" ? (["batches", "custody", "commissions"] as Workflow[])
            : (["custody", "commissions", "withdrawals", "batches"] as Workflow[])).map((key) =>
              <button type="button" key={key} onClick={() => openTask(key)}>{workflowLabels[key]} <span aria-hidden="true">←</span></button>)}
        </div> : null}
        <div className="fc-dashboard-grid">
          <section className="fc-register" aria-label="حالات المالية">
            <div className="fc-section-heading"><div><h2>{tab === "command" ? "قائمة القرارات المالية" : tab === "activity" ? "المعاملات في المصادر المحمّلة" : tab === "collection" ? "سجلات التحصيل والمتابعة" : tab === "settlements" ? "السحوبات والدفعات قيد المعالجة" : "معاملات تحتاج المطابقة"}</h2>
              <p>{tab === "command" ? "القرارات الأهم بحسب الأولوية، والمراجعة في السجل المعتمد" : "افتح السجل المتخصص للوصول إلى جميع الصفحات وتنفيذ الإجراءات"}</p></div>
              <span className="fc-count">{displayedRows.length.toLocaleString("ar-YE")} سجل محمّل</span></div>
            <div className="fc-toolbar">
              <label className="fc-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في المستفيد أو المرجع..." aria-label="البحث في المعاملات المحمّلة" /></label>
              <select aria-label="تصفية نوع المصدر" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
                <option value="all">جميع المصادر</option>{sources.map((source) => <option key={source.source} value={source.source}>{sourceLabels[source.source]}</option>)}
              </select>
              <label className="fc-priority"><input type="checkbox" checked={priorityOnly} onChange={(event) => setPriorityOnly(event.target.checked)} />الأعلى أولوية</label>
            </div>
            {tab === "command" ? <SettlementIntakeInbox search={search} visible onCountChange={setIntakeCount} /> : null}
            {loading && !hasData ? <p className="fc-placeholder" role="status">جارٍ قراءة المعاملات...</p> : null}
            {displayedRows.length > 0 ? <div className="fc-table-scroll"><table className="fc-table"><thead><tr>
              <th>الأولوية</th><th>المستفيد / المرجع</th><th>النوع</th><th>الحالة</th><th>المبلغ</th><th>الإجراء التالي</th><th>الملف</th>
            </tr></thead><tbody>{displayedRows.map((row) => <tr key={row.key} aria-selected={selected?.key === row.key} >
              <td><span className={"fc-priority-label " + (row.priority <= 1 ? "urgent" : row.priority <= 2 ? "high" : "normal")}>{row.priority === 1 ? "عاجلة" : row.priority === 2 ? "عالية" : "متابعة"}</span></td>
              <td><button className="fc-person" type="button" onClick={() => setFocusedKey(row.key)}><strong>{row.subject}</strong><small dir="auto">{row.reference}</small></button></td>
              <td>{row.category}</td><td><span className="fc-status">{row.state}</span></td><td dir="ltr">{row.amount}</td>
              <td className="fc-next-action">{row.nextStep}</td><td><button type="button" className="fc-inline-action" onClick={() => setFocusedKey(row.key)}>التفاصيل ←</button></td>
            </tr>)}</tbody></table></div> : null}
            {hasData && displayedRows.length === 0 && !loading ? <p className="fc-placeholder">لا توجد نتائج في المعاينة الحالية. يمكنك فتح السجلات الكاملة من المسارات الظاهرة.</p> : null}
            <div className="fc-register-footer"><span>{more.length ? "توجد صفحات أخرى في مصادر متعددة؛ المعروض ليس الإجمالي الكامل." : "معاينة من مصادر محدودة، وليست دفتر الأستاذ الكامل."}</span>
              <button type="button" className="fc-btn" onClick={() => changeTab("wallets")}>سجل المحافظ الكامل ←</button>
            </div>
          </section>
          <aside className="fc-case-panel" aria-label="تفاصيل الحالة المحددة">
            <div className="fc-case-title"><h2>تفاصيل الحالة المالية</h2><span aria-hidden="true">◈</span></div>
            {selected ? <>
              <div className="fc-case-person"><span className="fc-avatar" aria-hidden="true">◉</span><div><strong>{selected.subject}</strong><small dir="auto">{selected.reference}</small></div></div>
              <div className="fc-balance-hero"><small>قيمة الحركة محل المراجعة</small><strong dir="ltr">{selected.amount}</strong></div>
              <div className="fc-mini-metrics"><div><small>نوع الحركة</small><strong>{selected.category}</strong></div><div><small>الحالة</small><strong>{selected.state}</strong></div></div>
              <div className="fc-case-decision"><strong>الإجراء التالي</strong><p>{selected.nextStep}</p></div>
              <button type="button" className="fc-primary" onClick={() => openTask(workflowFor(selected), selected)}>فتح السجل للتحقق واتخاذ القرار ←</button>
              <p className="fc-note">لا يُستنتج رصيد المحفظة من مبلغ هذه الحركة. افتح سجل المحافظ لقراءة الرصيد الدفتري الحقيقي.</p>
            </> : <div className="fc-empty-side"><span aria-hidden="true">▤</span><h3>لا توجد حالة محددة</h3><p>اختر سجلًا من القائمة لعرض مرجعه والإجراء المناسب.</p></div>}
          </aside>
        </div>
        <div className="fc-actors-footer"><div><h2>المحافظ وأصحابها</h2><p>افتح أرصدة العميل والشريك والكابتن والميداني من دفتر المحفظة.</p></div>
          {["العملاء", "الشركاء", "الكباتن", "الميدانيون"].map((label, index) => <button type="button" key={label} onClick={() => changeTab("wallets")}><span aria-hidden="true">{["◉", "▣", "◈", "✧"][index]}</span><strong>{label}</strong><small>كشف المحفظة ←</small></button>)}
        </div>
      </>}
    </>}
  </section>;
}
