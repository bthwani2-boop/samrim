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

const CashCustodyWorkspace = dynamic(() => import("./cash-custody-workspace").then((module) => module.CashCustodyWorkspace));
const PartnerEarningsWorkspace = dynamic(() => import("./partner-earnings-workspace").then((module) => module.PartnerEarningsWorkspace));
const CustomerWithdrawalQueue = dynamic(() => import("./customer-withdrawal-queue").then((module) => module.CustomerWithdrawalQueue));
const BeneficiarySettlementWorkspace = dynamic(() => import("./beneficiary-settlement-workspace").then((module) => module.BeneficiarySettlementWorkspace));
const StoreCommercialAgreementWorkspace = dynamic(() => import("./store-commercial-agreement-workspace").then((module) => module.StoreCommercialAgreementWorkspace));
const StoreTypeCommissionDefaultWorkspace = dynamic(() => import("./store-type-commission-default-workspace").then((module) => module.StoreTypeCommissionDefaultWorkspace));

type Source = "custody" | "commissions" | "batches" | "withdrawals";
type Workflow = "custody" | "commissions" | "batches" | "withdrawals" | "settlement-partner" | "settlement-captain" | "settlement-field" | "agreements";
type Filter = "attention" | "all" | Source;
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
  const matching = rows.filter((row) =>
    (filter === "all" || (filter === "attention" ? row.priority <= 2 : row.source === filter)) &&
    [row.subject, row.reference, row.category, row.state, row.nextStep].some((value) => value.toLocaleLowerCase("ar").includes(search.toLocaleLowerCase("ar").trim())),
  );
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
    {!activeWorkflow ? <SettlementIntakeInbox /> : null}
    {activeWorkflow ? <div className="finance-center-active">
      <div className="finance-center-active-header">
        <div><h2>{workflowLabels[activeWorkflow]}</h2><p className="muted">الإجراءات الأصلية والصلاحيات المالية محفوظة داخل المركز نفسه.</p></div>
        <button type="button" className="button button-quiet" onClick={closeTask}>إغلاق التفاصيل</button>
      </div>
      <FinanceTask workflow={activeWorkflow} row={activeRow} query={initialQuery} />
    </div> : <>
      <section className="finance-center-kpis" aria-label="ملخص السجلات المحملة">
        <div><strong>{rows.filter((row) => row.priority <= 2).length.toLocaleString("ar-YE")}</strong><span>تحتاج مراجعة · المعروض</span></div>
        <div><strong>{(visible?.custody?.items.length ?? 0).toLocaleString("ar-YE")}</strong><span>عهد نقدية · المعروض</span></div>
        <div><strong>{(visible?.batches?.items.length ?? 0).toLocaleString("ar-YE")}</strong><span>دفعات مهيأة · المعروض</span></div>
        <div><strong>{(visible?.withdrawals?.items.length ?? 0).toLocaleString("ar-YE")}</strong><span>طلبات سحب جديدة · المعروض</span></div>
      </section>
      <div className="finance-center-toolbar">
        <label className="finance-center-search" htmlFor="finance-center-search">البحث في النتائج المعروضة
          <input id="finance-center-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الجهة أو المرجع أو نوع المعاملة" maxLength={128} />
        </label>
        <label className="finance-center-filter" htmlFor="finance-center-filter">نوع السجل
          <select id="finance-center-filter" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="attention">تحتاج مراجعة</option><option value="all">جميع المعروض</option>
            {sources.map((source) => <option key={source.source} value={source.source}>{source.label}</option>)}
          </select>
        </label>
        <label className="finance-center-filter" htmlFor="finance-center-manage">إدارة مالية
          <select id="finance-center-manage" value="" onChange={(event) => { const next = parseWorkflow(event.target.value); if (next) openTask(next); }} >
            <option value="">اختر السجل الكامل…</option>
            {(Object.keys(workflowLabels) as Workflow[]).map((key) => <option key={key} value={key}>{workflowLabels[key]}</option>)}
          </select>
        </label>
      </div>
      {errors.length > 0 ? <div className="managed-status managed-status-warning" role="alert">
        <strong>بعض المصادر المالية لم تُحمّل</strong>
        <p>{errors.map((source) => source.label + ": " + (visible?.[source.source]?.error ?? "")).join("؛ ")}</p>
        <button type="button" className="button button-secondary" onClick={() => void refresh()} disabled={loading}>إعادة المحاولة</button>
      </div> : null}
      <div className="finance-center-records">
        <div className="finance-center-records-header">
          <div><h2>سجل المتابعة المالية</h2><p>الأولوية أولًا · كل نوع محتفظ بمصدره المالي المستقل</p></div>
          <span>{matching.length.toLocaleString("ar-YE")} سجلًا معروضًا</span>
        </div>
        {loading && !hasData ? <p className="collection-state" role="status">جارٍ تحميل السجلات المالية…</p> : null}
        {hasData ? <div className="finance-center-table-scroll">
          <table className="finance-center-table">
            <thead><tr><th scope="col">الجهة / المرجع</th><th scope="col">النوع</th><th scope="col">الحالة والخطوة التالية</th><th scope="col">المبلغ</th><th scope="col">الإجراء</th></tr></thead>
            <tbody>{matching.map((row) => <tr key={row.key} data-priority={row.priority <= 2 ? "attention" : "normal"}>
              <th scope="row"><button className="finance-center-record-name" type="button" onClick={() => setFocusedKey(row.key)}>{row.subject}</button><small dir="auto">{row.reference}</small></th>
              <td><span className="finance-center-category">{row.category}</span></td>
              <td><strong>{row.state}</strong><small>{row.nextStep}</small></td>
              <td><bdi dir="ltr">{row.amount}</bdi></td>
              <td><button type="button" className="button button-secondary finance-center-row-action" onClick={() => openTask(workflowFor(row), row)}>
                {row.priority <= 2 ? "معالجة" : "متابعة"}
              </button></td>
            </tr>)}</tbody>
          </table>
          <ul className="finance-center-mobile" aria-label="السجلات المالية المعروضة">
            {matching.map((row) => <li key={row.key} data-priority={row.priority <= 2 ? "attention" : "normal"} data-selected={focusedKey === row.key ? "true" : undefined}>
              <div className="finance-center-mobile-heading">
                <button type="button" className="finance-center-record-name" onClick={() => setFocusedKey(row.key)}>{row.subject}</button>
                <span className="finance-center-category">{row.category}</span>
              </div>
              <small dir="auto">{row.reference}</small>
              <div className="finance-center-mobile-state"><strong>{row.state}</strong><span>{row.nextStep}</span></div>
              <div className="finance-center-mobile-actions">
                <bdi dir="ltr">{row.amount}</bdi>
                <button type="button" className="button button-secondary finance-center-row-action" onClick={() => openTask(workflowFor(row), row)}>
                  {row.priority <= 2 ? "معالجة" : "متابعة"}
                </button>
              </div>
            </li>)}
          </ul>
          {matching.length === 0 ? <div className="finance-center-empty">
            <strong>{errors.length ? "لا توجد نتائج ضمن المصادر التي حُمّلت" : "لا توجد سجلات مطابقة"}</strong>
            <p>غيّر البحث أو المرشح، أو افتح السجل الكامل للنوع المطلوب.</p>
          </div> : null}
        </div> : null}
        {hasData ? <div className="finance-center-records-footer">
          <span>{more.length ? "المعاينة محدودة حتى 25 سجلًا لكل مصدر؛ بقية السجلات متاحة عبر إدارة السجل الكامل." : "الملخص يعرض نتائج المصادر المحددة، ولا يمثل إجمالي الدفاتر المالية."}</span>
          <button type="button" className="button button-quiet" onClick={() => { setFilter("all"); setSearch(""); }}>عرض كل النتائج المحملة</button>
        </div> : null}
      </div>

    </>}
    </section>
  </AdaptiveRecordWorkspace>;
}