"use client";

import { captainAssignmentStateLabel, formatOrderDate, type OperatorOperationListItem, type OperatorOperationsSummary, orderStateLabel } from "@bthwani/dsh";
import { Alert, Button, Empty, Flex, Input, Select, Spin, Tag } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { RecordIndicator } from "../shared/record-indicator";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { operationalAge } from "./operational-age";
import { operationalStageElapsed, operationalStageAttention, operationalSlaAttention } from "./operational-stage-elapsed";
import { operationActionLabel, operationResponseMessage, resolveOperatorAction } from "./operator-actions";
import { OrderOperationDetail } from "./order-operation-detail";
import { CommandFrame, CommandSectionTabs } from "../shared/command-surface";
import { OperationsCommandView } from "./operations-command-view";
import { OperationsInterventionCenter } from "./operations-intervention-center";
import { OperationsDispatchOverview } from "./operations-dispatch-overview";
import { OperationsCoverageWorkspace } from "./operations-coverage-workspace";
import { CaptainAdmissionPanel } from "../captain/captain-admission-panel";
import { OperationsPerformance } from "./operations-performance";
import "./operations-unified.css";

function operationNeedsReview(item: OperatorOperationListItem, now: number): boolean {
  const stage = operationalSlaAttention(item, now) ?? operationalStageAttention(item.state, item.stageStartedAt, now, item.preparationMinutes);
  return stage ? stage.needsReview : operationalAge(item.state, item.updatedAt, now).needsReview;
}

type View = "command" | "all" | "attention" | "dispatch" | "captains" | "coverage" | "reports";
type OrderFilterKey = "storeName" | "fromDate" | "toDate" | "paymentSource" | "fulfillmentMode";
type Change = Readonly<{ view?: View; state?: string; q?: string; sort?: string; filters?: Partial<Record<OrderFilterKey, string>>; grouped?: boolean }>;

const paymentSourceOptions = [
  { value: "", label: "جميع توزيعات الدفع" },
  { value: "CASH", label: "نقد كامل" },
  { value: "WALLET", label: "محفظة كاملة" },
  { value: "MIXED", label: "نقد ومحفظة" },
];
const fulfillmentOptions = [
  { value: "", label: "جميع طرق التنفيذ" },
  { value: "BTHWANI_CAPTAIN", label: "كابتن بثواني" },
  { value: "PARTNER_CAPTAIN", label: "كابتن المتجر" },
  { value: "CUSTOMER_PICKUP", label: "استلام العميل" },
];

const views: ReadonlyArray<Readonly<{ id: View; label: string }>> = [
  { id: "command", label: "القيادة" },
  { id: "all", label: "الطلبات" },
  { id: "attention", label: "التدخلات" },
  { id: "dispatch", label: "الإسناد والتوصيل" },
  { id: "captains", label: "الكباتن" },
  { id: "coverage", label: "التغطية والخريطة" },
  { id: "reports", label: "الأداء والتقارير" },
];

const specificStates = [
  { value: "", label: "كل الحالات" },
  { value: "attention", label: "تحتاج قرارًا" },
  { value: "CREATED", label: "طلب جديد" },
  { value: "PARTNER_ACCEPTED", label: "قبله المتجر" },
  { value: "PREPARING", label: "قيد التجهيز" },
  { value: "READY_FOR_PICKUP", label: "جاهز لاستلام العميل" },
  { value: "READY_FOR_DISPATCH", label: "بانتظار كابتن" },
  { value: "DELIVERED", label: "تم التسليم" },
  { value: "CAPTAIN_ASSIGNED", label: "تم إسناد كابتن" },
  { value: "IN_CUSTODY", label: "في عهدة الكابتن" },
  { value: "PICKED_UP", label: "استلم من المتجر" },
  { value: "DELIVERY_FAILED", label: "تعثر التسليم" },
  { value: "REJECTED", label: "مرفوضة" },
  { value: "CANCELLED", label: "ملغاة" },
] as const;

const legacyState: Record<string, string> = {
  "exceptions:delivery-failed": "DELIVERY_FAILED",
  "exceptions:rejected": "REJECTED",
  "exceptions:cancelled": "CANCELLED",
  "execution:assigned": "CAPTAIN_ASSIGNED",
  "execution:custody": "IN_CUSTODY",
  "history:delivered": "DELIVERED",
  "history:picked-up": "PICKED_UP",
  "history:rejected": "REJECTED",
  "history:cancelled": "CANCELLED",
};

function isRenderableOperation(value: unknown): value is OperatorOperationListItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const assignment = item.assignment;
  return typeof item.orderId === "string" && item.orderId.trim().length > 0
    && typeof item.storeName === "string"
    && typeof item.state === "string" && item.state.length > 0
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
    && (assignment == null || (typeof assignment === "object" && !Array.isArray(assignment)
      && typeof (assignment as Record<string, unknown>).state === "string"));
}

function isRenderableSummary(value: unknown): value is OperatorOperationsSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const fields = ["totalCount", "actionableCount", "awaitingDispatchCount", "activeCount", "deliveredCount", "inCustodyOrderCount"];
  return fields.every((field) => Number.isSafeInteger(item[field]) && Number(item[field]) >= 0 && Number(item[field]) <= Number(item.totalCount))
    && Number.isSafeInteger(item.inCustodyOrderValueMinor) && Number(item.inCustodyOrderValueMinor) >= 0
    && typeof item.measuredAt === "string" && Number.isFinite(Date.parse(item.measuredAt));
}

export function OperationsWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const params = new URLSearchParams(queryString);
  const oldLane = params.get("lane") ?? "";
  const oldSub = params.get("sub") ?? (oldLane === "exceptions" ? "delivery-failed" : oldLane === "execution" ? "assigned" : oldLane === "history" ? "delivered" : "");
  const oldState = legacyState[oldLane + ":" + oldSub] ?? (oldLane === "dispatch" ? "READY_FOR_DISPATCH" : "");
  const rawView = params.get("view");
  const view: View = views.some((item) => item.id === rawView) ? rawView as View
    : oldLane === "attention" ? "attention"
    : oldLane === "dispatch" ? "dispatch"
    : oldState === "DELIVERED" || rawView === "delivered" ? "all" : (!oldLane && !oldState && !params.has("state") && !params.has("q") ? "command" : "all");
  const preciseState = params.get("state") ?? (oldState || (rawView === "delivered" ? "DELIVERED" : ""));
  const state = preciseState || (view === "dispatch" ? "READY_FOR_DISPATCH" : "");
  const actionableOnly = view === "attention" && !preciseState;
  const searchFromUrl = (params.get("q") ?? "").trim().slice(0, 128);
  const sort = params.get("sort") === "updated_asc" ? "updated_asc" : "updated_desc";
  const storeName = (params.get("storeName") ?? "").trim().slice(0, 128);
  const fromDate = params.get("fromDate") ?? "";
  const toDate = params.get("toDate") ?? "";
  const paymentSource = params.get("paymentSource") ?? "";
  const fulfillmentMode = params.get("fulfillmentMode") ?? "";
  const groupByCheckout = params.get("group") === "checkout";
  const cursorPage = useCursorPage("cursor", JSON.stringify([state, actionableOnly, searchFromUrl, sort, storeName, fromDate, toDate, paymentSource, fulfillmentMode]));
  const cursor = cursorPage.cursor;

  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [summary, setSummary] = useState<OperatorOperationsSummary | null>(null);
  const [ageClock, setAgeClock] = useState(0);
  const [search, setSearch] = useState(searchFromUrl);
  const [storeSearch, setStoreSearch] = useState(storeName);
  const pageCaptainFilter = ["assigned", "unassigned"].includes(params.get("captainFilter") ?? "")
    ? params.get("captainFilter") ?? "all" : "all";
  const pageReviewFilter = ["overdue", "action"].includes(params.get("reviewFilter") ?? "")
    ? params.get("reviewFilter") ?? "all" : "all";
  const changePageFilter = (key: "captainFilter" | "reviewFilter", value: string) => {
    const next = new URLSearchParams(queryString);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    router.push(pathname + "?" + next.toString(), { scroll: false });
  };
  const setPageCaptainFilter = (value: string) => changePageFilter("captainFilter", value);
  const setPageReviewFilter = (value: string) => changePageFilter("reviewFilter", value);
  const visibleOperations = operations.filter((item) =>
    (pageCaptainFilter === "all" || (pageCaptainFilter === "assigned" ? Boolean(item.assignment) : !item.assignment))
    && (pageReviewFilter === "all" || (pageReviewFilter === "overdue" ? operationNeedsReview(item, ageClock || Date.now()) : Boolean(resolveOperatorAction({ state: item.state, assignment: item.assignment }))))
  );
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState((params.get("order") ?? "").slice(0,160));
  const [visitedCaptains, setVisitedCaptains] = useState(view === "captains");
  const tabScroll = useRef<Partial<Record<View, number>>>({});
  useEffect(() => { if (view === "captains") setVisitedCaptains(true); }, [view]);
  useEffect(() => {
    const y = tabScroll.current[view];
    if (y === undefined) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [view]);
  const [cancellationInboxVersion, setCancellationInboxVersion] = useState(0);
  const loadSequence = useRef(0);

  useEffect(() => setSearch(searchFromUrl), [searchFromUrl]);
  useEffect(() => setStoreSearch(storeName), [storeName]);
  useEffect(() => setSelectedOrderId((new URLSearchParams(queryString).get("order") ?? "").slice(0,160)), [queryString]);
  useEffect(() => {
    setAgeClock(Date.now());
    const timer = setInterval(() => setAgeClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const navigate = useCallback((changes: Change) => {
    cursorPage.clearForNavigation();
    if (changes.view && changes.view !== view) tabScroll.current[view] = window.scrollY;
    setSelectedOrderId("");
    const next = new URLSearchParams(queryString);
    next.delete("lane");
    next.delete("sub");
    next.delete("captain");
    next.delete("order");
    const nextView = changes.view ?? view;
    if (nextView === "command") next.delete("view");
    else next.set("view", nextView);
    const nextState = changes.state ?? preciseState;
    if (nextState) next.set("state", nextState);
    else next.delete("state");
    if (changes.q !== undefined) {
      if (changes.q) next.set("q", changes.q);
      else next.delete("q");
    }
    if (changes.sort !== undefined) {
      if (changes.sort === "updated_desc") next.delete("sort");
      else next.set("sort", changes.sort);
    }
    if (changes.filters) {
      for (const [key, value] of Object.entries(changes.filters)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
    }
    if (changes.grouped !== undefined) {
      if (changes.grouped) next.set("group", "checkout");
      else next.delete("group");
    }
    next.delete("cursor");
    const serialized = next.toString();
    router.push(pathname + (serialized ? "?" + serialized : ""), { scroll: false });
  }, [cursorPage.clearForNavigation, pathname, preciseState, queryString, router, view]);

  const load = useCallback(async (retainRows = false) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    if (!retainRows) { setOperations([]); setSummary(null); }
    setError("");
    setErrorStatus(0);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (state) query.set("state", state);
      if (actionableOnly) query.set("actionableOnly", "true");
      if (searchFromUrl) query.set("q", searchFromUrl);
       if (storeName) query.set("storeName", storeName);
       if (fromDate) query.set("fromDate", fromDate);
       if (toDate) query.set("toDate", toDate);
       if (paymentSource) query.set("paymentSource", paymentSource);
       if (fulfillmentMode) query.set("fulfillmentMode", fulfillmentMode);
      if (sort !== "updated_desc") query.set("sort", sort);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch("/api/operations?" + query.toString(), {
        cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
      if (sequence !== loadSequence.current) return;
      if (!response.ok) throw Object.assign(new Error(await operationResponseMessage(response)), { status: response.status });
      const body = await response.json() as { operations?: ReadonlyArray<OperatorOperationListItem>; nextCursor?: string; summary?: OperatorOperationsSummary };
      if (sequence !== loadSequence.current) return;
      if (!body || !Array.isArray(body.operations) || !body.operations.every(isRenderableOperation)
        || (body.nextCursor !== undefined && typeof body.nextCursor !== "string")
        || !isRenderableSummary(body.summary)) {
        throw new Error("استجابة قائمة الطلبات غير صالحة. أعد المحاولة.");
      }
      setOperations(body.operations);
      setSummary(body.summary ?? null);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      // Never leave stale rows or a usable next cursor after an unverified read.
      setOperations([]);
      setSummary(null);
      setNextCursor("");
      setErrorStatus(cause && typeof cause === "object" && "status" in cause && typeof cause.status === "number" ? cause.status : 0);
      const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      setError(timedOut ? "استغرقت القراءة وقتًا طويلًا. أعد المحاولة." : cause instanceof Error ? cause.message : "تعذر قراءة مركز العمليات.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [actionableOnly, cursor, searchFromUrl, storeName, fromDate, toDate, paymentSource, fulfillmentMode, sort, state]);

  useEffect(() => {
    if (cursorPage.ready) void load();
    return () => { loadSequence.current += 1; };
  }, [load, cursorPage.ready]);
  useReadOnReturn(() => load(true), cursorPage.ready && !loading);
  useEffect(() => {
    if (!cursorPage.ready || loading || view === "reports") return;
    const timer = setInterval(() => {
      if (!document.hidden) void load(true);
    }, 60_000);
    return () => clearInterval(timer);
  }, [cursorPage.ready, load, loading, view]);

  const overdueOnPage = operations.filter((item) => operationNeedsReview(item, ageClock || Date.now())).length;
  const hasSearch = Boolean(searchFromUrl);
  const hasFilters = Boolean(hasSearch || preciseState || storeName || fromDate || toDate || paymentSource || fulfillmentMode || view === "attention" || view === "dispatch");
  const resetFilters = () => {
    setSearch("");
    setStoreSearch("");
    navigate({ view: "all", state: "", q: "", sort: "updated_desc", filters: { storeName: "", fromDate: "", toDate: "", paymentSource: "", fulfillmentMode: "" } });
  };
  const groupedOperations = groupByCheckout ? [...visibleOperations].sort((a, b) => {
    if (Boolean(a.multiStoreCheckoutId) !== Boolean(b.multiStoreCheckoutId)) return a.multiStoreCheckoutId ? -1 : 1;
    if (!a.multiStoreCheckoutId || !b.multiStoreCheckoutId) return 0;
    return a.multiStoreCheckoutId.localeCompare(b.multiStoreCheckoutId);
  }) : visibleOperations;
  const selectedFilter = preciseState || (view === "attention" ? "attention" : view === "dispatch" ? "READY_FOR_DISPATCH" : "");
  const selectedViewLabel = preciseState ? specificStates.find((item) => item.value === preciseState)?.label ?? preciseState
    : views.find((item) => item.id === view)?.label ?? "جميع الطلبات";

  const selectedIndex = operations.findIndex((item) => item.orderId === selectedOrderId);
  const openOrder = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    const next = new URLSearchParams(queryString);
    if (orderId) next.set("order", orderId);
    else next.delete("order");
    router.push(pathname + "?" + next.toString(), {scroll:false});
  },[pathname,queryString,router]);
  const closeSelected = () => openOrder("");

  return (
    <AdaptiveRecordWorkspace
      open={Boolean(selectedOrderId)}
      preferenceKey="operations"
      onClose={closeSelected}
      detail={selectedOrderId ? <AdaptiveRecordPanel
        title="ملف الطلب"
        onClose={closeSelected}
        onPrevious={selectedIndex > 0 ? () => {
          const previous = operations[selectedIndex - 1];
          if (previous) openOrder(previous.orderId);
        } : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < operations.length - 1 ? () => {
          const next = operations[selectedIndex + 1];
          if (next) openOrder(next.orderId);
        } : undefined}
      >
        <OrderOperationDetail orderId={selectedOrderId} embedded onClose={closeSelected} onUpdated={() => {setCancellationInboxVersion(v => v+1); void load(true)}} />
      </AdaptiveRecordPanel> : null}>
    <section className="operations-workspace ops-center" aria-label="مركز متابعة الطلبات">
      <CommandFrame title="مركز العمليات" subtitle="قرارات الطلبات والتغطية التشغيلية من البيانات المعتمدة">
        <CommandSectionTabs label="أقسام العمليات" active={view} tabs={views} onSelect={next => navigate({view:next,state:""})}/>
        {view === "command" ? <OperationsCommandView summary={summary} operations={operations}
          isAttention={item => operationNeedsReview(item, ageClock || Date.now())}
          onOpen={openOrder} onView={next => navigate({view: next === "delivered" ? "all" : next, state:next === "delivered" ? "DELIVERED" : ""})} loading={loading} />
        : view === "captains" ? null
        : view === "coverage" ? <OperationsCoverageWorkspace summary={summary}
          onDispatch={() => navigate({view:"dispatch",state:""})} onCaptains={() => navigate({view:"captains",state:""})} />
        : view === "reports" ? <OperationsPerformance summary={summary} operations={operations} loading={loading} />
        : view === "attention" ? <OperationsInterventionCenter onOpenOrder={openOrder} refreshVersion={cancellationInboxVersion} />
        : <>
       <div className="ops-order-metrics" aria-label="ملخص نتائج الطلبات المطابقة للفلاتر">
         {([
           { key: "total", label: "الإجمالي", count: summary?.totalCount, action: () => navigate({ view: "all", state: "" }) },
           { key: "attention", label: "تحتاج مراجعة", count: summary?.actionableCount, action: null },
           { key: "dispatch", label: "بانتظار الإسناد", count: summary?.awaitingDispatchCount, action: () => navigate({ view: "dispatch", state: "" }) },
           { key: "active", label: "نشطة", count: summary?.activeCount, action: null },
           { key: "delivered", label: "تم التسليم", count: summary?.deliveredCount, action: () => navigate({ view: "all", state: "DELIVERED" }) },
           { key: "custody", label: "في عهدة الكابتن", count: summary?.inCustodyOrderCount, action: null },
         ] as const).map(metric => metric.action
           ? <button key={metric.key} type="button" className="ops-order-metric" onClick={metric.action} disabled={loading || !summary}>
               <strong>{metric.count == null ? "—" : metric.count.toLocaleString("ar-YE")}</strong><span>{metric.label}</span>
             </button>
           : <div key={metric.key} className="ops-order-metric">
               <strong>{metric.count == null ? "—" : metric.count.toLocaleString("ar-YE")}</strong><span>{metric.label}</span>
             </div>)}
       </div>
       <p className="muted ops-metric-note">المؤشرات محسوبة على جميع السجلات المطابقة في DSH قبل ترقيم الصفحات، وليست مجموع الصفحة المعروضة.</p>
       {view === "dispatch" ? <OperationsDispatchOverview state={state} summary={summary}
        onState={next => navigate({view:"dispatch",state:next})}
        onView={next => navigate({view:next,state:""})} /> : null}
      <Flex className="ops-tools" gap="middle" wrap align="end">
        <search aria-label="البحث في الطلبات" style={{ flex: "1 1 280px", minWidth: 0 }}>
          <label htmlFor="ops-search-input" className="visually-hidden">رقم الطلب أو اسم المتجر</label>
          <Input.Search
            id="ops-search-input"
            aria-label="رقم الطلب أو اسم المتجر"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
             onSearch={() => navigate({ q: search.trim().slice(0, 128) })}
            placeholder="رقم الطلب أو اسم المتجر"
            maxLength={128}
            allowClear
            enterButton="بحث"
          />
        </search>
        <Flex vertical gap="small" style={{ flex: "1 1 160px", minWidth: 145 }}>
          <label htmlFor="ops-order-state">حالة الطلب</label>
          <Select
            id="ops-order-state"
            aria-label="تصفية حسب حالة الطلب"
            value={selectedFilter}
            options={[
              ...specificStates.map((item) => ({ value: item.value, label: item.label })),
              ...(preciseState && !specificStates.some((item) => item.value === preciseState)
                ? [{ value: preciseState, label: preciseState }] : []),
            ]}
            onChange={(chosen: string) => navigate({
              view: chosen === "attention" ? "attention" : view,
              state: chosen === "attention" ? "" : chosen,
            })}
          />
        </Flex>
        <Flex vertical gap="small" style={{ flex: "1 1 160px", minWidth: 145 }}>
          <label htmlFor="operations-sort">الترتيب</label>
          <Select
            id="operations-sort"
            aria-label="ترتيب الطلبات"
            value={sort}
            onChange={(chosen: string) => navigate({ sort: chosen })}
            options={[{ value: "updated_desc", label: "الأحدث أولًا" }, { value: "updated_asc", label: "الأقدم أولًا" }]}
          />
        </Flex>
       </Flex>
       <Flex className="ops-tools ops-advanced-filters" gap="middle" wrap align="end" role="group" aria-label="فلاتر الطلبات الإضافية">
         <Flex vertical gap="small" style={{ flex: "1 1 200px", minWidth: 170 }}>
           <label htmlFor="ops-store-name">المتجر</label>
           <Input.Search id="ops-store-name" aria-label="البحث باسم المتجر" value={storeSearch}
             onChange={event => setStoreSearch(event.target.value)}
             onSearch={() => navigate({ filters: { storeName: storeSearch.trim().slice(0, 128) } })}
             placeholder="اسم المتجر" allowClear maxLength={128} enterButton="تصفية" />
         </Flex>
         <Flex vertical gap="small" style={{ flex: "1 1 145px", minWidth: 140 }}>
           <label htmlFor="ops-from-date">من تاريخ الإنشاء</label>
           <Input id="ops-from-date" type="date" aria-label="من تاريخ إنشاء الطلب" value={fromDate}
             max={toDate || undefined}
             onChange={event => navigate({ filters: { fromDate: event.target.value } })} />
         </Flex>
         <Flex vertical gap="small" style={{ flex: "1 1 145px", minWidth: 140 }}>
           <label htmlFor="ops-to-date">إلى تاريخ الإنشاء</label>
           <Input id="ops-to-date" type="date" aria-label="إلى تاريخ إنشاء الطلب" value={toDate}
             min={fromDate || undefined}
             onChange={event => navigate({ filters: { toDate: event.target.value } })} />
         </Flex>
         <Flex vertical gap="small" style={{ flex: "1 1 175px", minWidth: 155 }}>
           <label htmlFor="ops-payment-source">توزيع الدفع المسجل</label>
           <Select id="ops-payment-source" aria-label="تصفية حسب التوزيع المسجل للدفع"
             value={paymentSource} options={paymentSourceOptions}
             onChange={(chosen: string) => navigate({ filters: { paymentSource: chosen } })} />
         </Flex>
         <Flex vertical gap="small" style={{ flex: "1 1 175px", minWidth: 155 }}>
           <label htmlFor="ops-fulfillment-mode">طريقة التنفيذ</label>
           <Select id="ops-fulfillment-mode" aria-label="تصفية حسب طريقة التنفيذ"
             value={fulfillmentMode} options={fulfillmentOptions}
             onChange={(chosen: string) => navigate({ filters: { fulfillmentMode: chosen } })} />
         </Flex>
       </Flex>
       <Flex align="center" gap="small" wrap className="ops-active-filters" role="group" aria-label="الفلاتر النشطة">
         {hasSearch ? <Tag closable onClose={event => { event.preventDefault(); setSearch(""); navigate({ q: "" }); }}>البحث: {searchFromUrl}</Tag> : null}
         {preciseState ? <Tag closable onClose={event => { event.preventDefault(); navigate({ state: "" }); }}>الحالة: {specificStates.find(item => item.value === preciseState)?.label ?? preciseState}</Tag> : null}
         {storeName ? <Tag closable onClose={event => { event.preventDefault(); setStoreSearch(""); navigate({ filters: { storeName: "" } }); }}>المتجر: {storeName}</Tag> : null}
         {fromDate ? <Tag closable onClose={event => { event.preventDefault(); navigate({ filters: { fromDate: "" } }); }}>من: {fromDate}</Tag> : null}
         {toDate ? <Tag closable onClose={event => { event.preventDefault(); navigate({ filters: { toDate: "" } }); }}>إلى: {toDate}</Tag> : null}
         {paymentSource ? <Tag closable onClose={event => { event.preventDefault(); navigate({ filters: { paymentSource: "" } }); }}>الدفع: {paymentSourceOptions.find(item => item.value === paymentSource)?.label ?? paymentSource}</Tag> : null}
         {fulfillmentMode ? <Tag closable onClose={event => { event.preventDefault(); navigate({ filters: { fulfillmentMode: "" } }); }}>التنفيذ: {fulfillmentOptions.find(item => item.value === fulfillmentMode)?.label ?? fulfillmentMode}</Tag> : null}
         {hasFilters ? <Button onClick={resetFilters}>مسح جميع الفلاتر</Button> : null}
       </Flex>
      {error ? (
        <Alert
          role="alert"
          type="warning"
          showIcon
          message={errorStatus === 403 ? "لا تملك صلاحية قراءة الطلبات" : "تعذر قراءة الطلبات"}
          description={error}
          action={<Button disabled={loading} onClick={() => void load(true)}>إعادة المحاولة</Button>}
        />
      ) : null}

      {overdueOnPage > 0 ? (
        <Alert
          type="warning"
          showIcon
          role="status"
          message={`${overdueOnPage.toLocaleString("ar-YE")} طلب متأخر أو متعثر في الصفحة الحالية.`}
          action={<Button onClick={() => setPageReviewFilter("overdue")}>عرض المتأخرة في الصفحة</Button>}
        />
      ) : null}
       <div className="ops-list-heading">
         <div className="ops-list-name"><h2 id="operations-list-title">{selectedViewLabel}</h2>
           <span className="muted">{operations.length} طلب في هذه الصفحة{visibleOperations.length !== operations.length ? " · معروض من الصفحة " + visibleOperations.length : ""}{summary ? ` · ${summary.totalCount} إجمالي النتائج` : ""}{nextCursor ? " · المزيد في الصفحة التالية" : ""}</span>
         </div>
         <Button type="default" aria-pressed={groupByCheckout} onClick={() => navigate({ grouped: !groupByCheckout })}>
           {groupByCheckout ? "إلغاء تجميع الطلبات" : "تجميع الطلبات المرتبطة"}
         </Button>
       </div>
       {groupByCheckout ? <p className="muted ops-metric-note" role="status">التجميع بصري لطلبات المتاجر المرتبطة داخل الصفحة الحالية فقط؛ الطلبات في صفحات أخرى تظل مستقلة ويمكن فتح كل منها على حدة.</p> : null}

       {loading && operations.length === 0 ? (
        <Flex gap="small" align="center" role="status">
          <Spin size="small" /> جارٍ تحميل الطلبات...
        </Flex>
      ) : null}
       {!loading && !error && operations.length === 0 ? (
         <Empty description={hasFilters ? "لا توجد طلبات تطابق الفلاتر المحددة" : cursor ? "لا توجد طلبات إضافية في هذه الصفحة" : "لا توجد طلبات مسجلة في هذا العرض"}>
           {hasFilters ? <Button onClick={resetFilters}>مسح الفلاتر وعرض الطلبات</Button> : cursor ? <Button onClick={() => navigate({})}>العودة إلى أول صفحة</Button> : null}
         </Empty>
       ) : null}

      <div className="ops-results">
        {operations.length > 0 ? (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: This labeled, horizontally scrollable table region must be keyboard-focusable.
          <section className="operations-table-wrap" aria-label="قائمة الطلبات؛ تمرير أفقي عند الحاجة" tabIndex={0}>
            <table className="operations-table ops-list-table">
               <caption className="visually-hidden">{selectedViewLabel}، خمسون طلبًا كحد أقصى في الصفحة، وتجميع اختياري للطلبات المرتبطة داخل الصفحة</caption>
              <thead><tr>
                <th scope="col">المتجر</th>
                <th scope="col">الحالة</th>
                <RegistryColumnHeader label="الكابتن" active={pageCaptainFilter !== "all"} scope="page">
                  <Flex vertical gap="small">
                    <label htmlFor="ops-captain-filter">الإسناد</label>
                    <Select
                      id="ops-captain-filter"
                      aria-label="تصفية الإسناد في الصفحة"
                      size="small"
                      value={pageCaptainFilter}
                      onChange={(value: string) => setPageCaptainFilter(value)}
                      options={[{ value: "all", label: "الكل" }, { value: "assigned", label: "مسند" }, { value: "unassigned", label: "غير مسند" }]}
                      style={{ minWidth: 118 }}
                    />
                  </Flex>
                </RegistryColumnHeader>
                <th scope="col">آخر تحديث</th>
                <RegistryColumnHeader label="المتابعة" active={pageReviewFilter !== "all"} scope="page">
                  <Flex vertical gap="small">
                    <label htmlFor="ops-review-filter">حالة المتابعة</label>
                    <Select
                      id="ops-review-filter"
                      aria-label="تصفية المتابعة في الصفحة"
                      size="small"
                      value={pageReviewFilter}
                      onChange={(value: string) => setPageReviewFilter(value)}
                      options={[{ value: "all", label: "الجميع" }, { value: "overdue", label: "متعثر أو متأخر" }, { value: "action", label: "له إجراء متاح" }]}
                      style={{ minWidth: 145 }}
                    />
                  </Flex>
                </RegistryColumnHeader>
                <th scope="col">فتح الطلب</th>
              </tr></thead>
              <tbody>
                {visibleOperations.length === 0 ? <tr><td colSpan={6} className="catalog-table-state">لا توجد مطابقة في الصفحة الحالية. أزل مرشح الإسناد أو المتابعة.</td></tr> : null}
                 {groupedOperations.map((item, index) => {
                   const age = operationalAge(item.state, item.updatedAt, ageClock || Date.now());
                  const stageAttention = operationalSlaAttention(item, ageClock || Date.now()) ?? operationalStageAttention(item.state, item.stageStartedAt, ageClock || Date.now(), item.preparationMinutes);
                  const needsReview = stageAttention ? stageAttention.needsReview : age.needsReview;
                  const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                   const newCheckoutGroup = groupByCheckout && item.multiStoreCheckoutId && (index === 0 || groupedOperations[index - 1]?.multiStoreCheckoutId !== item.multiStoreCheckoutId);
                   return <Fragment key={item.orderId}>
                     {newCheckoutGroup ? <tr className="ops-checkout-group"><td colSpan={6}>طلب متعدد المتاجر <code dir="ltr" title={item.multiStoreCheckoutId}>#{item.multiStoreCheckoutId.slice(-8)}</code> · {groupedOperations.filter(candidate => candidate.multiStoreCheckoutId === item.multiStoreCheckoutId).length} طلب في هذه الصفحة</td></tr> : null}
                     <tr className={needsReview ? "ops-row-review" : undefined}>
                     <th scope="row">{item.storeName}<small className="muted ops-order-short-id" dir="ltr" title={item.orderId}>#{item.orderId.slice(-8)}</small>{!groupByCheckout && item.multiStoreCheckoutId ? <small className="muted ops-order-short-id">ضمن طلب متعدد المتاجر <code dir="ltr" title={item.multiStoreCheckoutId}>#{item.multiStoreCheckoutId.slice(-8)}</code></small> : null}</th>
                    <td><span className={"status-badge status-" + item.state.toLowerCase()}>{orderStateLabel(item.state)}</span></td>
                    <td>{item.assignment ? <span className="ops-captain-cell">
                      <span>{captainAssignmentStateLabel(item.assignment.state)}</span>
                    </span> : <span className="muted">غير مسند</span>}</td>
                    <td><time dateTime={item.updatedAt}>{formatOrderDate(item.updatedAt)}</time></td>
                    <td><div className="ops-row-followup">
                      <span className={needsReview ? "operations-attention" : "muted"}>{stageAttention ? stageAttention.label : age.label}</span>
                      {!stageAttention && operationalStageElapsed(item.stageStartedAt, ageClock || Date.parse(item.updatedAt)) ? <span className="muted">{operationalStageElapsed(item.stageStartedAt, ageClock || Date.parse(item.updatedAt))}</span> : null}
                      {nextAction ? <RecordIndicator legend icon="review" label={operationActionLabel(nextAction)} tone="warning" /> : null}
                    </div></td>
                    <td><Button aria-label={(nextAction || needsReview ? "مراجعة" : "تفاصيل") + " طلب " + item.orderId.slice(-8) + " من " + item.storeName} onClick={() => openOrder(item.orderId)}>{nextAction || needsReview ? "مراجعة" : "تفاصيل"}</Button></td>
                   </tr>
                   </Fragment>;
                 })}
               </tbody>
            </table>
            <ul className="ops-mobile-orders" aria-label="طلبات الصفحة">
               {groupedOperations.map((item) => {
                 const age = operationalAge(item.state, item.updatedAt, ageClock || Date.now());
                const stageAttention = operationalSlaAttention(item, ageClock || Date.now()) ?? operationalStageAttention(item.state, item.stageStartedAt, ageClock || Date.now(), item.preparationMinutes);
                const needsReview = stageAttention ? stageAttention.needsReview : age.needsReview;
                const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                return <li key={item.orderId} className={"ops-mobile-order" + (needsReview ? " ops-mobile-order-review" : "")}>
                   {item.multiStoreCheckoutId ? <small className="ops-order-group-label">طلب متعدد المتاجر <code dir="ltr" title={item.multiStoreCheckoutId}>#{item.multiStoreCheckoutId.slice(-8)}</code></small> : null}
                   <div className="ops-mobile-order-heading">
                     <strong>{item.storeName}</strong><small className="muted ops-order-short-id" dir="ltr" title={item.orderId}>#{item.orderId.slice(-8)}</small>
                   </div>
                  <div className="ops-mobile-order-status">
                    <span className={"status-badge status-" + item.state.toLowerCase()}>{orderStateLabel(item.state)}</span>
                    <span className="ops-mobile-order-captain">{item.assignment ? captainAssignmentStateLabel(item.assignment.state) : "غير مسند"}</span>
                  </div>
                  <div className="ops-mobile-order-followup">
                    <span className={needsReview ? "operations-attention" : "muted"}>{stageAttention ? stageAttention.label : age.label}</span>
                      {!stageAttention && operationalStageElapsed(item.stageStartedAt, ageClock || Date.parse(item.updatedAt)) ? <span className="muted">{operationalStageElapsed(item.stageStartedAt, ageClock || Date.parse(item.updatedAt))}</span> : null}
                    {nextAction ? <RecordIndicator legend icon="review" label={operationActionLabel(nextAction)} tone="warning" /> : null}
                  </div>
                  <div className="ops-mobile-order-bottom">
                    <time dateTime={item.updatedAt}>آخر تحديث: {formatOrderDate(item.updatedAt)}</time>
                    <Button aria-label={(nextAction || needsReview ? "مراجعة الطلب" : "تفاصيل الطلب") + " رقم " + item.orderId.slice(-8) + " من " + item.storeName} onClick={() => openOrder(item.orderId)}>{nextAction || needsReview ? "مراجعة الطلب" : "تفاصيل الطلب"}</Button>
                  </div>
                </li>;
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات الطلبات" />
        </>}
        {visitedCaptains ? <div className="ops-captains-panel" data-testid="operations-captains"
          hidden={view !== "captains"}><CaptainAdmissionPanel active={view === "captains"}/></div> : null}
      </CommandFrame>
    </section>
    </AdaptiveRecordWorkspace>
  );
}
