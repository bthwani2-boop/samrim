"use client";

import { formatMoney, type PartnerFinancialActivity, type PartnerFinancialActivityPage } from "@bthwani/dsh";
import { Button, Table, type TableColumnsType, type TableProps } from "antd";
import Link from "next/link";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./partner-financial-register.css";

type Filters = { storeId: string; kind: string; status: string; paymentMethod: string; period: string; search: string };
type ActivityPageState = { queryKey: string; items: PartnerFinancialActivity[]; stores: NonNullable<PartnerFinancialActivityPage["stores"]>; cursor: string };
type RequestState = { queryKey: string; loading: boolean; loadingMore: boolean; error: string; moreError: string };
const defaults: Filters = { storeId: "", kind: "", status: "", paymentMethod: "", period: "month", search: "" };
const kindOptions = [["", "كل الحركات"], ["ORDER", "مستحقات الطلبات"], ["PAYOUT", "صرف"], ["CASH_COMMISSION", "ذمم العمولة"]];
const statusOptions = [["", "كل الحالات"], ["POSTED", "مثبت"], ["PENDING", "قيد الصرف"], ["COMPLETED", "مصروف"], ["EXCEPTION", "يحتاج مراجعة"], ["CANCELLED", "ملغى"]];
const paymentOptions = [["", "كل طرق الدفع"], ["CASH_ON_DELIVERY", "نقدي عند التسليم"], ["CASH_AT_STORE", "نقدي للمتجر"], ["WALLET", "محفظة"], ["MIXED", "مختلط"]];

function periodRange(period: string) {
  if (period === "all") return {};
  const now = new Date();
  const day = (date: Date) => new Date(date.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const to = day(now);
  if (period === "today") return { from: to, to };
  if (period === "week") return { from: day(new Date(now.getTime() - 6 * 86_400_000)), to };
  return { from: to.slice(0, 7) + "-01", to };
}
function activityType(item: PartnerFinancialActivity) {
  return item.kind === "ORDER" ? "مستحقات طلب" : item.kind === "PAYOUT" ? "صرف مستحقات" : "تسوية طلب نقدي";
}
function stateLabel(item: PartnerFinancialActivity) {
  if (item.kind === "ORDER") return "مثبت";
  if (item.kind === "CASH_COMMISSION") return item.direction === "CREDIT" ? "رصيد وذمة" : item.direction === "NONE" ? "دون حركة" : "ذمة عمولة";
  return ({ COMPLETED: "مكتمل", CANCELLED: "ملغى", EXCEPTION: "تحتاج مراجعة", HELD: "قيد الصرف", PREPARED: "قيد الصرف", APPROVED: "قيد الصرف", FROZEN: "قيد الصرف", EXECUTED: "قيد الصرف" } as Record<string, string>)[item.status] ?? item.status;
}
function currency(item: PartnerFinancialActivity) {
  const prefix = item.direction === "CREDIT" ? "+" : item.direction === "DEBIT" || item.direction === "RECEIVABLE" ? "−" : "";
  return prefix + formatMoney(item.amountMinor, item.currency);
}
function dateLabel(value: string) {
  return new Date(value).toLocaleString("ar-YE", { timeZone: "Asia/Aden", dateStyle: "medium", timeStyle: "short" });
}
function activityKey(item: PartnerFinancialActivity) { return item.kind + ":" + item.id; }
function isCurrentPartnerActivityRequest(requestId: number, currentRequestId: number, requestKey: string, currentKey: string): boolean {
  return requestId === currentRequestId && requestKey === currentKey;
}
const columns: TableColumnsType<PartnerFinancialActivity> = [
  { key: "reference", title: "التاريخ والمرجع", render: (_value, item) => <div className="pfr-reference"><strong>{dateLabel(item.createdAt)}</strong><small dir="auto">#{item.id}</small></div> },
  { key: "kind", title: "نوع الحركة", render: (_value, item) => activityType(item) },
  { key: "store", title: "المتجر / الدفع", render: (_value, item) => <>{item.storeName}<small className="pfr-block-muted">{item.paymentMethod ? ({ CASH_ON_DELIVERY: "نقدي عند التسليم", CASH_AT_STORE: "نقدي للمتجر", WALLET: "محفظة", MIXED: "مختلط" } as Record<string, string>)[item.paymentMethod] ?? item.paymentMethod : "—"}</small></> },
  { key: "gross", title: "المنتجات", render: (_value, item) => item.kind === "PAYOUT" ? "—" : formatMoney(item.grossMinor, item.currency) },
  { key: "commission", title: "العمولة", render: (_value, item) => item.kind === "PAYOUT" ? "—" : formatMoney(item.commissionMinor, item.currency) },
  { key: "amount", title: "الصافي أو المستحق", render: (_value, item) => <strong className="pfr-money">{currency(item)}</strong> },
  { key: "status", title: "الحالة", render: (_value, item) => <span className="pfr-state">{stateLabel(item)}</span> },
];
function select(name: string, options: string[][], value: string, update: (value: string) => void) {
  return <label className="pfr-field"><span>{name}</span><select value={value} onChange={(event) => update(event.target.value)}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>;
}

export function PartnerFinancialRegister({ partnerActorId, storeId = "", compact = false }: { partnerActorId: string; storeId?: string; compact?: boolean }) {
  const [filters, setFilters] = useState<Filters>(defaults);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<ActivityPageState | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [requestState, setRequestState] = useState<RequestState>({ queryKey: "", loading: true, loadingMore: false, error: "", moreError: "" });
  const [retrySequence, setRetrySequence] = useState(0);
  const queryKey = JSON.stringify([partnerActorId, storeId, compact, filters, retrySequence]);
  const currentQueryKey = useRef(queryKey);
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const visiblePage = page?.queryKey === queryKey ? page : null;
  const visibleRequest = requestState.queryKey === queryKey ? requestState : null;
  const loading = visibleRequest?.loading ?? true;
  const loadingMore = visibleRequest?.loadingMore ?? false;
  const items = visiblePage?.items ?? [];
  const cursor = visiblePage?.cursor ?? "";

  useLayoutEffect(() => { currentQueryKey.current = queryKey; }, [queryKey]);
  useEffect(() => {
    const requestId = ++requestGeneration.current;
    const controller = new AbortController();
    requestController.current = controller;
    const isCurrent = () => isCurrentPartnerActivityRequest(requestId, requestGeneration.current, queryKey, currentQueryKey.current);
    const query = new URLSearchParams({ partnerActorId, limit: compact ? "5" : "25", ...periodRange(filters.period) });
    if (storeId) query.set("storeId", storeId);
    for (const field of ["storeId", "kind", "status", "paymentMethod", "search"] as const) if (filters[field] && !(storeId && field === "storeId")) query.set(field, filters[field]);
    setPage({ queryKey, items: [], stores: [], cursor: "" });
    setExpanded([]);
    setRequestState({ queryKey, loading: true, loadingMore: false, error: "", moreError: "" });
    void fetch("/api/finance/partner-activity?" + query, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذرت قراءة الحركات المالية (" + response.status + ")");
        return await response.json() as PartnerFinancialActivityPage;
      })
      .then((result) => {
        if (!isCurrent()) return;
        setPage((previous) => isCurrent() ? { queryKey, items: [...result.items], stores: result.stores ?? [], cursor: result.nextCursor ?? "" } : previous);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || !isCurrent()) return;
        setRequestState((previous) => isCurrent() ? { ...previous, queryKey, error: cause instanceof Error ? cause.message : "تعذرت قراءة الحركات" } : previous);
      })
      .finally(() => {
        if (isCurrent()) setRequestState((previous) => isCurrent() ? { ...previous, queryKey, loading: false } : previous);
      });
    return () => {
      controller.abort();
      if (requestGeneration.current === requestId) requestGeneration.current += 1;
      if (requestController.current === controller) requestController.current = null;
    };
  }, [partnerActorId, storeId, compact, filters, queryKey]);

  useEffect(() => {
    const timeout = setTimeout(() => setFilters((current) => ({ ...current, search: search.trim() })), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const update = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  async function more() {
    const controller = requestController.current;
    const requestId = requestGeneration.current;
    const requestKey = queryKey;
    const requestCursor = cursor;
    if (!controller || controller.signal.aborted || !requestCursor || loadingMore || loading) return;
    const isCurrent = () => isCurrentPartnerActivityRequest(requestId, requestGeneration.current, requestKey, currentQueryKey.current);
    setRequestState((previous) => isCurrent() && previous.queryKey === requestKey ? { ...previous, loadingMore: true, moreError: "" } : previous);
    const query = new URLSearchParams({ partnerActorId, limit: "25", cursor: requestCursor, ...periodRange(filters.period) });
    if (storeId) query.set("storeId", storeId);
    for (const field of ["storeId", "kind", "status", "paymentMethod", "search"] as const) if (filters[field] && !(storeId && field === "storeId")) query.set(field, filters[field]);
    try {
      const response = await fetch("/api/finance/partner-activity?" + query, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("تعذرت قراءة الصفحة التالية");
      const nextPage = await response.json() as PartnerFinancialActivityPage;
      if (!isCurrent()) return;
      setPage((previous) => {
        if (!isCurrent() || previous?.queryKey !== requestKey) return previous;
        const known = new Set(previous.items.map(activityKey));
        return { ...previous, items: [...previous.items, ...nextPage.items.filter((item) => !known.has(activityKey(item)))], cursor: nextPage.nextCursor ?? "" };
      });
    } catch (cause: unknown) {
      if (!controller.signal.aborted && isCurrent()) setRequestState((previous) => isCurrent() && previous.queryKey === requestKey ? { ...previous, moreError: cause instanceof Error ? cause.message : "تعذرت قراءة الصفحة" } : previous);
    } finally {
      if (isCurrent()) setRequestState((previous) => isCurrent() && previous.queryKey === requestKey ? { ...previous, loadingMore: false } : previous);
    }
  }

  const retryPage = () => setRetrySequence((current) => current + 1);
  const moreError = visibleRequest?.moreError ?? "";
  const error = visibleRequest?.error ?? "";
  const expandable: NonNullable<TableProps<PartnerFinancialActivity>["expandable"]> = {
    expandedRowKeys: expanded,
    onExpand: (isExpanded, item) => setExpanded(isExpanded ? [activityKey(item)] : []),
    expandedRowRender: (item) => <ActivityDetails item={item} />,
    rowExpandable: () => true,
    expandIcon: ({ expanded: isExpanded, onExpand, record }) => <Button className="pfr-expand" type="text" size="small" aria-label={isExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل"} aria-expanded={isExpanded} aria-controls={"pfr-detail-" + record.kind + "-" + record.id} onClick={(event: MouseEvent<HTMLElement>) => onExpand(record, event)}>{isExpanded ? "−" : "+"}</Button>,
  };

  return <section className="pfr-root" aria-label="الحركات المالية للشريك">
    <div className="pfr-head"><div><h3>الكشف المالي للمتاجر</h3><p>حركات موثقة من الدفتر المالي WLT، وليست تقديرات من الطلبات</p></div>
      {compact ? <Link href={"/finance/partner-earnings?partnerActorId=" + encodeURIComponent(partnerActorId)} className="button button-secondary">فتح الإدارة المالية</Link> : null}
    </div>
    {!compact ? <div className="pfr-toolbar">
      <label className="pfr-field pfr-search"><span>بحث برقم الطلب أو الصرف</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" maxLength={128} placeholder="ابحث في جميع الحركات..." /></label>
      {select("الفترة", [["today", "اليوم"], ["week", "7 أيام"], ["month", "هذا الشهر"], ["all", "كل الفترات"]], filters.period, (value) => update("period", value))}
      {!storeId ? select("المتجر", [["", "كل المتاجر"], ...((visiblePage?.stores ?? []).map((store) => [store.storeId, store.storeName]))], filters.storeId, (value) => update("storeId", value)) : null}
      {select("نوع الحركة", kindOptions, filters.kind, (value) => update("kind", value))}
      {select("الحالة", statusOptions, filters.status, (value) => update("status", value))}
      {select("الدفع", paymentOptions, filters.paymentMethod, (value) => update("paymentMethod", value))}
      <button className="button button-quiet" type="button" onClick={() => { setFilters(defaults); setSearch(""); }}>مسح الفلاتر</button>
    </div> : null}
    {error ? <div className="state-error pfr-error" role="alert"><span>{error}</span><Button onClick={retryPage}>إعادة المحاولة</Button></div> : null}
    {loading ? <p className="muted" role="status">جارٍ قراءة السجل المالي…</p> : null}
    <section className="pfr-table-wrap" aria-label="قائمة الحركات المالية المسندة للمتاجر">
      <Table<PartnerFinancialActivity> className="pfr-table" columns={columns} dataSource={items} rowKey={activityKey} pagination={false} virtual={items.length > 60 && expanded.length === 0 && !compact} loading={loading} expandable={expandable} scroll={compact ? { x: 900 } : { x: 900, y: 620 }} locale={{ emptyText: loading ? " " : "لا توجد حركات مالية مطابقة لهذه الفلاتر." }} />
    </section>
    <div className="pfr-bottom">
      <span className="muted">المعروض: {items.length.toLocaleString("ar-YE")}{cursor ? "+" : ""} حركة · التصفية على جميع السجلات</span>
      {!compact && cursor ? <div className="pfr-more">{moreError ? <span role="alert">{moreError}</span> : null}<Button className="button-secondary" disabled={loadingMore || loading} onClick={() => void more()}>{loadingMore ? "جارٍ التحميل..." : moreError ? "إعادة المحاولة" : "تحميل المزيد"}</Button></div> : null}
    </div>
  </section>;
}

function ActivityDetails({ item }: { item: PartnerFinancialActivity }) {
  const direction = item.direction === "RECEIVABLE" ? "ذمة عمولة، ليست خصمًا من رصيد المتجر" : item.direction === "HOLD" ? "حجز مستحق، لم يُصرف بعد" : item.direction === "DEBIT" ? "صرف مكتمل" : item.direction === "NONE" ? "لا أثر مباشر على المحفظة" : "إضافة مثبتة لرصيد المستحقات";
  return <div className="pfr-detail" id={"pfr-detail-" + item.kind + "-" + item.id}>
    <div><strong>مرجع العملية</strong><span dir="auto">{item.id}</span></div>
    <div><strong>المتجر</strong><span>{item.storeName}</span></div>
    <div><strong>نوع القيد</strong><span>{direction}</span></div>
    {item.offsetMinor ? <div><strong>مقاصة عمولة</strong><span>{formatMoney(item.offsetMinor, item.currency)}</span></div> : null}
    {item.ledgerTransactionId ? <div><strong>مرجع القيد المحاسبي</strong><span dir="auto">{item.ledgerTransactionId}</span></div> : null}
  </div>;
}
