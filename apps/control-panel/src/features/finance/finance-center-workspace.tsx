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
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { PageHeader } from "../../shell/page-header";
import { SettlementIntakeInbox } from "./settlement-intake-inbox";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { RegistryColumnHeader } from "../shared/registry-column-header";

const CashCustodyWorkspace = dynamic(() => import("./cash-custody-workspace").then((module) => module.CashCustodyWorkspace));
const PartnerEarningsWorkspace = dynamic(() => import("./partner-earnings-workspace").then((module) => module.PartnerEarningsWorkspace));
const CustomerWithdrawalQueue = dynamic(() => import("./customer-withdrawal-queue").then((module) => module.CustomerWithdrawalQueue));
const BeneficiarySettlementWorkspace = dynamic(() => import("./beneficiary-settlement-workspace").then((module) => module.BeneficiarySettlementWorkspace));
const StoreCommercialAgreementWorkspace = dynamic(() => import("./store-commercial-agreement-workspace").then((module) => module.StoreCommercialAgreementWorkspace));
const StoreTypeCommissionDefaultWorkspace = dynamic(() => import("./store-type-commission-default-workspace").then((module) => module.StoreTypeCommissionDefaultWorkspace));

type Source = "custody" | "commissions" | "batches" | "withdrawals";
type Workflow = "custody" | "commissions" | "batches" | "withdrawals" | "settlement-partner" | "settlement-captain" | "settlement-field" | "agreements";
type Filter = "attention" | "all" | "settlements" | Source;
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
  { source: "custody", label: "العهد النقدية", endpoint: "/api/finance/cash-custody?limit=25&sort=collected_asc" },
  { source: "commissions", label: "ذمم عمولة المنصة", endpoint: "/api/finance/partner-commission-receivables?limit=25&sort=actor_asc" },
  { source: "batches", label: "دفعات تنتظر الاعتماد", endpoint: "/api/finance/settlement-batches?limit=25&status=PREPARED" },
  { source: "withdrawals", label: "سحوبات العملاء", endpoint: "/api/finance/customer-withdrawal-intakes?limit=25&status=REQUESTED&sort=requested_asc" },
];
const sourceLabels: Record<Source, string> = {
  custody: "العهد النقدية",
  commissions: "ذمم عمولة المنصة",
  batches: "دفعات التحويل",
  withdrawals: "سحوبات العملاء",
};
const workflowLabels: Record<Workflow, string> = {
  custody: "العهد النقدية والتوريدات",
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
        reference: item.externalReference, category: "عهدة نقدية",
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
  const actor = state.kind === "authenticated" && state.identity.role === "operator"
    && state.identity.permissions?.includes("finance") ? state.identity.subject : null;
  const [snapshot, setSnapshot] = useState<{ actor: string; results: Partial<Record<Source, ReadResult>> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("attention");
  const [search, setSearch] = useState("");
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
  useEffect(() => {
    if (!focusedKey) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusedKey(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [focusedKey]);

  const rows = useMemo(() => sources.flatMap((source) => visible?.[source.source]?.items ?? [])
    .sort((a, b) => a.priority - b.priority || (a.date ?? "").localeCompare(b.date ?? "") || a.key.localeCompare(b.key)), [visible]);
  const displayedRows = rows.filter((row) =>
    (filter === "all" || (filter === "attention" && row.priority <= 2) || row.source === filter) &&
    [row.subject, row.reference, row.category, row.state, row.nextStep, row.amount]
      .some((value) => value.toLocaleLowerCase("ar").includes(search.toLocaleLowerCase("ar").trim())),
  );
  const showIntakes = filter === "all" || filter === "attention" || filter === "settlements";
  const sourceAttentionCount = rows.filter((row) => row.priority <= 2).length;
  const shownIntakes = showIntakes && (intakeCount ?? 0) > 0;

  const selected = rows.find((row) => row.key === focusedKey) ?? null;
  const errors = sources.filter((source) => Boolean(visible?.[source.source]?.error));
  const more = sources.filter((source) => visible?.[source.source]?.hasMore);
  const hasData = Boolean(visible);

  const openTask = (workflow: Workflow, row: FinancialRow | null = null) => {
    setFocusedKey(null);
    setActiveRow(row);
    setActiveWorkflow(workflow);
  };
  const closeTask = () => {
    if (Object.keys(initialQuery).length) router.replace("/finance", { scroll: false });
    setActiveWorkflow(null);
    setActiveRow(null);
    setFocusedKey(null);
    void refresh();
  };

  if (state.kind !== "authenticated") return null;
  if (!actor) return <section className="state-content workspace-restricted" role="alert">
    <h1>صلاحية المالية غير متاحة</h1><p>تحتاج إلى صلاحية المالية للاطلاع على المعاملات.</p>
  </section>;

  return <AdaptiveRecordWorkspace
    open={!activeWorkflow && Boolean(selected)}
    preferenceKey="finance"
    onClose={() => setFocusedKey(null)}
    detail={selected && !activeWorkflow ? <AdaptiveRecordPanel title="معاينة المعاملة المالية" subtitle={selected.category} onClose={() => setFocusedKey(null)}>
      <div className="finance-center-inspector-content">
        <h3>{selected.subject}</h3>
        <dl><dt>نوع العملية</dt><dd>{selected.category}</dd><dt>المرجع</dt><dd dir="auto">{selected.reference}</dd>
          <dt>المبلغ</dt><dd>{selected.amount}</dd><dt>الحالة</dt><dd>{selected.state}</dd>
          <dt>الإجراء التالي</dt><dd>{selected.nextStep}</dd></dl>
        <p className="muted">تُقرأ المستندات والأرصدة والتفاصيل المحاسبية من سجلها المختص قبل التنفيذ.</p>
        <button type="button" className="button button-primary" onClick={() => openTask(workflowFor(selected), selected)}>فتح المعالجة داخل الصفحة</button>
      </div>
    </AdaptiveRecordPanel> : null}>
    <section className="workspace-page finance-center" aria-labelledby="finance-center-title">
    <PageHeader id="finance-center-title" title="المالية"
      actions={activeWorkflow
        ? <button type="button" className="button button-secondary" onClick={closeTask}>العودة إلى المركز المالي</button>
        : errors.length > 0 ? <button type="button" className="button button-secondary" onClick={() => void refresh()} disabled={loading}>إعادة المحاولة</button> : undefined} />
    {activeWorkflow ? <div className="finance-center-active">
      <div className="finance-center-active-header">
        <div><h2>{workflowLabels[activeWorkflow]}</h2><p className="muted">الإجراءات والصلاحيات المالية تُنفذ في سجلها المختص.</p></div>
        <button type="button" className="button button-quiet" onClick={closeTask}>إغلاق التفاصيل</button>
      </div>
      <FinanceTask workflow={activeWorkflow} row={activeRow} query={initialQuery} />
    </div> : <>
      <div className="finance-desk-summary">
        <div><strong>{intakeCount === null || !hasData ? "—" : (intakeCount + sourceAttentionCount).toLocaleString("ar-YE")}</strong><span>تحتاج متابعة · المعروض</span></div>
        <div><strong>{hasData ? rows.length.toLocaleString("ar-YE") : "—"}</strong><span>معاملات من المصادر المحمّلة</span></div>
        {errors.length ? <div className="finance-desk-source-warning" role="status"><strong>{errors.length.toLocaleString("ar-YE")}</strong><span>مصادر تتطلب إعادة المحاولة</span></div> : null}
      </div>
      <div className="finance-desk-controls">
        <label htmlFor="finance-desk-search" className="finance-desk-search">
          <span className="finance-desk-search-icon" aria-hidden="true">⌕</span>
          <input id="finance-desk-search" type="search" autoComplete="off" maxLength={128}
            aria-label="البحث في المعاملات المالية المحمّلة"
            placeholder="ابحث عن معاملة أو مستفيد أو مرجع · النتائج المحمّلة"
            value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <fieldset className="finance-desk-filterbar" aria-label="نوع السجلات المالية">
          {([
            ["attention", "تحتاج مراجعة"],
            ["all", "الكل"],
            ["settlements", "طلبات التسوية"],
            ["custody", "العهد النقدية"],
            ["commissions", "العمولات"],
            ["batches", "دفعات التحويل"],
            ["withdrawals", "السحوبات"],
          ] as const).map(([value, label]) => <button type="button" key={value}
            aria-pressed={filter === value} data-selected={filter === value ? "true" : undefined}
            className="finance-desk-chip" onClick={() => setFilter(value)}>
            {label}{value === "attention" && intakeCount !== null && hasData && intakeCount + sourceAttentionCount > 0
              ? <bdi dir="ltr" className="finance-desk-chip-count">{(intakeCount + sourceAttentionCount).toLocaleString("ar-YE")}</bdi> : null}
          </button>)}
        </fieldset>
      </div>
      {errors.length > 0 ? <div className="managed-status managed-status-warning" role="alert">
        <strong>تعذر تحميل بعض المصادر المالية</strong>
        <p>{errors.map((source) => source.label + ": " + (visible?.[source.source]?.error ?? "")).join("؛ ")}</p>
        <button type="button" className="button button-secondary" onClick={() => void refresh()} disabled={loading}>إعادة المحاولة</button>
      </div> : null}
      <section className="finance-desk-register" aria-label="المعاملات المالية">
        <div className="finance-desk-register-head">
          <div><h2>{filter === "attention" ? "تحتاج مراجعتك" : "المعاملات المالية"}</h2>
            <p>النتائج مرتبة حسب الأولوية · كل إجراء يُنفذ من مصدره المعتمد</p></div>
          <details className="finance-desk-specialized">
            <summary>السجلات المتخصصة</summary>
            <div className="finance-desk-specialized-menu">
              {(Object.keys(workflowLabels) as Workflow[]).map((key) =>
                <button type="button" key={key} onClick={() => openTask(key)}>{workflowLabels[key]}</button>)}
            </div>
          </details>
        </div>
        <SettlementIntakeInbox search={search} visible={showIntakes} onCountChange={setIntakeCount} />
        {loading && !hasData ? <p role="status" className="collection-state">جارٍ قراءة السجلات المالية…</p> : null}
        {hasData && filter !== "settlements" ? <div className="finance-desk-table-area">
          {displayedRows.length > 0 ? <>
            <div className="finance-desk-table-caption">سجلات المصادر الأخرى <span>معاينة محدودة · 25 سجلًا كحد أقصى لكل مصدر</span></div>
            <div className="finance-center-table-scroll">
              <table className="finance-center-table finance-desk-table">
                <thead><tr><th scope="col">المستفيد / المرجع</th><th scope="col">النوع</th>
                  <th scope="col">الحالة</th><th scope="col">المبلغ</th><th scope="col">الإجراء</th></tr></thead>
                <tbody>{displayedRows.map((row) => <tr key={row.key} data-priority={row.priority <= 2 ? "attention" : "normal"}>
                  <th scope="row"><button className="finance-center-record-name" type="button" onClick={() => setFocusedKey(row.key)}>{row.subject}</button>
                    <small dir="auto">{row.reference}</small></th>
                  <td>{row.category}</td>
                  <td><span className={row.priority <= 2 ? "finance-desk-status" : "finance-desk-state"}>{row.state}</span></td>
                  <td><bdi dir="ltr">{row.amount}</bdi></td>
                  <td><button type="button" className="button button-secondary finance-center-row-action"
                    onClick={() => setFocusedKey(row.key)}>{row.priority <= 2 ? "مراجعة الطلب" : "التفاصيل"}</button></td>
                </tr>)}</tbody>
              </table>
              <ul className="finance-center-mobile" aria-label="معاملات المصادر المالية">
                {displayedRows.map((row) => <li key={row.key} data-priority={row.priority <= 2 ? "attention" : "normal"}>
                  <div className="finance-center-mobile-heading"><strong>{row.subject}</strong><span>{row.category}</span></div>
                  <div className="finance-center-mobile-state"><span>{row.state}</span><small dir="auto">{row.reference}</small></div>
                  <div className="finance-center-mobile-actions"><bdi dir="ltr">{row.amount}</bdi>
                    <button type="button" className="button button-secondary" onClick={() => setFocusedKey(row.key)}>مراجعة الطلب</button></div>
                </li>)}
              </ul>
            </div>
          </> : null}
        </div> : null}
        {hasData && !loading && !shownIntakes && displayedRows.length === 0 && intakeCount !== null && !errors.length
          ? <div className="finance-desk-empty"><strong>لا توجد معاملات تحتاج تدخلًا هنا</strong>
              <p>جرّب «الكل» أو استخدم البحث أو افتح السجلات المتخصصة.</p></div> : null}
        <div className="finance-desk-register-foot">
          <span>{more.length ? "بعض المصادر تحتوي صفحات إضافية؛ افتح سجلها المتخصص للبحث الكامل." :
            "هذه قائمة عمل مجمّعة من سجلات محدودة، وليست إجمالي دفتر الأستاذ."}</span>
          {(search || filter !== "attention") ? <button type="button" className="button button-quiet" onClick={() => { setFilter("attention"); setSearch(""); }}>إعادة العرض الافتراضي</button> : null}
        </div>
      </section>
    </>}
    </section>
  </AdaptiveRecordWorkspace>;
}