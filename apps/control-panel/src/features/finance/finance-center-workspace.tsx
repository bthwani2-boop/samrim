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
import { FinanceReferenceDashboard, type FinanceReferenceRow, type FinanceReferenceWorkflow } from "./finance-reference-dashboard";

import { PageHeader } from "../../shell/page-header";

import { useReadOnReturn } from "../shared/use-read-on-return";

const CashCustodyWorkspace = dynamic(() => import("./cash-custody-workspace").then((module) => module.CashCustodyWorkspace));
const PartnerEarningsWorkspace = dynamic(() => import("./partner-earnings-workspace").then((module) => module.PartnerEarningsWorkspace));
const CustomerWithdrawalQueue = dynamic(() => import("./customer-withdrawal-queue").then((module) => module.CustomerWithdrawalQueue));
const BeneficiarySettlementWorkspace = dynamic(() => import("./beneficiary-settlement-workspace").then((module) => module.BeneficiarySettlementWorkspace));
const StoreCommercialAgreementWorkspace = dynamic(() => import("./store-commercial-agreement-workspace").then((module) => module.StoreCommercialAgreementWorkspace));
const StoreTypeCommissionDefaultWorkspace = dynamic(() => import("./store-type-commission-default-workspace").then((module) => module.StoreTypeCommissionDefaultWorkspace));

type Source = "custody" | "commissions" | "batches" | "withdrawals";
type Workflow = "custody" | "commissions" | "batches" | "withdrawals" | "settlement-partner" | "settlement-captain" | "settlement-field" | "agreements";
type FinancialRow = Readonly<{ amountMinor?: number;
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
        amount: formatMoney(item.amountMinor, item.currency), amountMinor: item.amountMinor, priority: pending ? 1 : 4,
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
      amount: formatMoney(item.outstandingCommissionReceivableMinor, item.currency), amountMinor: item.outstandingCommissionReceivableMinor,
      priority: item.outstandingCommissionReceivableMinor > 0 ? 2 : 5,
    }));
  }
  if (source === "batches") {
    return (body as { batches: readonly SettlementBatch[] }).batches.map((item) => ({
      source, key: source + ":" + item.id, id: item.id,
      subject: "دفعة من " + item.rowCount.toLocaleString("ar-YE") + " تحويل",
      reference: "دفعة · " + item.id, category: "تسوية مالية",
      state: "بانتظار الاعتماد", nextStep: "مراجعة الدفعة واعتمادها وفق الصلاحية",
      amount: formatMoney(item.totalAmountMinor, item.currency), amountMinor: item.totalAmountMinor, priority: 1,
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
  const actor = state.kind === "authenticated" && state.identity.role === "operator" &&
    state.identity.permissions?.includes("finance") ? state.identity.subject : null;
  const [snapshot, setSnapshot] = useState<{ actor: string; results: Partial<Record<Source, ReadResult>> } | null>(null);
  const [loading, setLoading] = useState(false);
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
  useEffect(() => { void refresh(); return () => { sequence.current += 1; }; }, [refresh]);
  useReadOnReturn(refresh, Boolean(actor) && !loading && !activeWorkflow);
  const rows = useMemo(() => sources.flatMap(source => visible?.[source.source]?.items ?? [])
    .sort((a,b) => a.priority - b.priority || (a.date ?? "").localeCompare(b.date ?? "") || a.key.localeCompare(b.key)), [visible]);
  const errors = sources.filter(source => Boolean(visible?.[source.source]?.error)).map(source => source.label);
  const hasMore = sources.some(source => visible?.[source.source]?.hasMore);
  const openTask = (workflow: FinanceReferenceWorkflow, row: FinanceReferenceRow | null) => { setActiveRow(row); setActiveWorkflow(workflow); };
  const closeTask = () => {
    if (Object.keys(initialQuery).length) router.replace("/finance", { scroll: false });
    setActiveWorkflow(null); setActiveRow(null); void refresh();
  };
  if (state.kind !== "authenticated") return null;
  if (!actor) return <section className="state-content workspace-restricted" role="alert">
    <h1>صلاحية المالية غير متاحة</h1><p>يتطلب عرض الأرصدة والكشوف إذن المالية.</p>
  </section>;
  if (activeWorkflow) return <section className="workspace-page finance-center" aria-labelledby="finance-center-title">
    <PageHeader id="finance-center-title" title={workflowLabels[activeWorkflow]} actions={<button
      type="button" className="button button-secondary" onClick={closeTask}>العودة إلى المركز المالي</button>} />
    <div className="finance-center-active"><FinanceTask workflow={activeWorkflow} row={activeRow} query={initialQuery} /></div>
  </section>;
  return <section className="workspace-page fc-reference-page" aria-label="المركز المالي">
    <FinanceReferenceDashboard rows={rows} errors={errors} hasData={Boolean(visible)} hasMore={hasMore} onOpenWorkflow={openTask}/>
  </section>;
}
