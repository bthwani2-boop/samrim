"use client";

import { captainAssignmentStateLabel, formatOrderDate, type OperatorOperationListItem, type OperatorOperationsSummary, orderStateLabel } from "@bthwani/dsh";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { RecordIndicator } from "../shared/record-indicator";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { operationalAge } from "./operational-age";
import { operationalStageElapsed, operationalStageAttention } from "./operational-stage-elapsed";
import { operationActionLabel, operationResponseMessage, resolveOperatorAction } from "./operator-actions";
import { OrderOperationDetail } from "./order-operation-detail";
import { CancellationRequestInbox } from "./cancellation-request-inbox";
import { CustomerContactQueue } from "./customer-contact-queue";
import { CommandFrame, CommandSectionTabs } from "../shared/command-surface";
import { OperationsCommandView } from "./operations-command-view";
import { OperatorCaseInbox } from "./operator-case-inbox";
import { CaptainAdmissionPanel } from "../captain/captain-admission-panel";
import { OpportunityZones } from "./opportunity-zones";
import { OperationsPerformance } from "./operations-performance";
import "./operations-unified.css";

function operationNeedsReview(item: OperatorOperationListItem, now: number): boolean {
  const stage = operationalStageAttention(item.state, item.stageStartedAt, now, item.preparationMinutes);
  return stage ? stage.needsReview : operationalAge(item.state, item.updatedAt, now).needsReview;
}

type View = "command" | "all" | "attention" | "dispatch" | "captains" | "coverage" | "reports";
type Change = Readonly<{ view?: View; state?: string; q?: string; sort?: string }>;

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
  const cursorPage = useCursorPage("cursor", JSON.stringify([state, actionableOnly, searchFromUrl, sort]));
  const cursor = cursorPage.cursor;

  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [summary, setSummary] = useState<OperatorOperationsSummary | null>(null);
  const [ageClock, setAgeClock] = useState(0);
  const [search, setSearch] = useState(searchFromUrl);
  const [pageCaptainFilter, setPageCaptainFilter] = useState("all");
  const [pageReviewFilter, setPageReviewFilter] = useState("all");
  const visibleOperations = operations.filter((item) =>
    (pageCaptainFilter === "all" || (pageCaptainFilter === "assigned" ? Boolean(item.assignment) : !item.assignment))
    && (pageReviewFilter === "all" || (pageReviewFilter === "overdue" ? operationNeedsReview(item, ageClock || Date.now()) : Boolean(resolveOperatorAction({ state: item.state, assignment: item.assignment }))))
  );
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState((params.get("order") ?? "").slice(0,160));
  const [secondaryInbox, setSecondaryInbox] = useState<"contacts" | "cancellations" | null>(null);
  const [cancellationInboxVersion, setCancellationInboxVersion] = useState(0);
  const loadSequence = useRef(0);

  useEffect(() => setSearch(searchFromUrl), [searchFromUrl]);
  useEffect(() => setSelectedOrderId((new URLSearchParams(queryString).get("order") ?? "").slice(0,160)), [queryString]);
  useEffect(() => {
    setAgeClock(Date.now());
    const timer = setInterval(() => setAgeClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const navigate = useCallback((changes: Change) => {
    cursorPage.clearForNavigation();
    setSelectedOrderId("");
    const next = new URLSearchParams(queryString);
    next.delete("lane");
    next.delete("sub");
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
  }, [actionableOnly, cursor, searchFromUrl, sort, state]);

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
        : view === "captains" ? <div className="ops-captains-panel" data-testid="operations-captains"><CaptainAdmissionPanel /></div>
        : view === "coverage" ? <div className="ops-coverage-panel"><OpportunityZones variant="full" /></div>
        : view === "reports" ? <OperationsPerformance summary={summary} operations={operations} loading={loading} />
        : <>
      {view === "attention" ? <section className="ops-intervention-priority" data-testid="operations-interventions">
        <OperatorCaseInbox onOpenOrder={openOrder} refreshVersion={cancellationInboxVersion} />
        <div className="ops-intervention-tools">
          <button type="button" className={secondaryInbox==="contacts"?"is-current":""} aria-expanded={secondaryInbox==="contacts"} onClick={()=>setSecondaryInbox(current=>current==="contacts"?null:"contacts")}>التحقق من العملاء</button>
          <button type="button" className={secondaryInbox==="cancellations"?"is-current":""} aria-expanded={secondaryInbox==="cancellations"} onClick={()=>setSecondaryInbox(current=>current==="cancellations"?null:"cancellations")}>طلبات الإلغاء</button>
        </div>
        {secondaryInbox === "contacts" ? <CustomerContactQueue onOpenOrder={openOrder} refreshVersion={cancellationInboxVersion} /> : null}
        {secondaryInbox === "cancellations" ? <CancellationRequestInbox onOpenOrder={openOrder} refreshVersion={cancellationInboxVersion} /> : null}
      </section> : null}
      <div className="ops-tools">
        <search className="ops-search" aria-label="البحث في الطلبات">
          <form noValidate onSubmit={(event) => {
            event.preventDefault();
            navigate({ view, state: "", q: search.trim().slice(0, 128) });
          }}>
            <label className="visually-hidden" htmlFor="ops-search-input">رقم الطلب أو اسم المتجر</label>
            <input id="ops-search-input" type="search" value={search} maxLength={128}
              onChange={(event) => setSearch(event.target.value)} placeholder="رقم الطلب أو اسم المتجر" />
            <button type="submit" className="button button-secondary">بحث</button>
          </form>
        </search>
        <details className="ops-more-filters">
          <summary>تصفية وترتيب</summary>
          <div className="ops-more-filters-content">
            <label className="ops-select-label">حالة الطلب
              <select aria-label="تصفية حسب حالة الطلب" value={selectedFilter} onChange={(event) => {
                const chosen = event.target.value;
                navigate({ view: chosen === "attention" ? "attention" : view, state: chosen === "attention" ? "" : chosen });
              }}>
                {specificStates.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                {preciseState && !specificStates.some((item) => item.value === preciseState) ? <option value={preciseState}>{preciseState}</option> : null}
              </select>
            </label>
            <label className="ops-select-label">الترتيب
              <select id="operations-sort" aria-label="ترتيب الطلبات" value={sort} onChange={(event) => navigate({ sort: event.target.value })}>
                <option value="updated_desc">الأحدث أولًا</option>
                <option value="updated_asc">الأقدم أولًا</option>
              </select>
            </label>
          </div>
        </details>
      </div>

      {hasSearch ? (
        <div className="ops-active-search"><span>البحث: {searchFromUrl}</span>
          <button type="button" onClick={() => { setSearch(""); navigate({ q: "" }); }}>مسح البحث ×</button>
        </div>
      ) : null}
      {error ? <div className="managed-status managed-status-warning" role="alert">
        <strong>{errorStatus === 403 ? "لا تملك صلاحية قراءة الطلبات" : "تعذر قراءة الطلبات"}</strong>
        <p>{error}</p><button className="button button-secondary" type="button" onClick={() => void load(true)} disabled={loading}>إعادة المحاولة</button>
      </div> : null}

      {overdueOnPage > 0 ? <div className="operations-attention-note" role="status">
        <span>{overdueOnPage.toLocaleString("ar-YE")} طلب متأخر أو متعثر في الصفحة الحالية.</span>
        <button type="button" className="button button-secondary" onClick={() => setPageReviewFilter("overdue")}>
          عرض المتأخرة في الصفحة
        </button>
      </div> : null}
      <div className="ops-list-heading">
        <div className="ops-list-name"><h2 id="operations-list-title">{selectedViewLabel}</h2>
          <span className="muted">{operations.length} طلب في هذه الصفحة{visibleOperations.length !== operations.length ? " · معروض من الصفحة " + visibleOperations.length : ""}{summary ? ` · ${summary.totalCount} إجمالي النتائج` : ""}{nextCursor ? " · المزيد في الصفحة التالية" : ""}</span>
        </div>

      </div>

      {loading && operations.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" />جارٍ تحميل الطلبات...</div> : null}
      {!loading && !error && operations.length === 0 ? <div className="collection-state">
        <strong>{hasSearch ? "لا توجد طلبات تطابق البحث" : "لا توجد طلبات في هذا العرض"}</strong>
        {hasSearch ? <button type="button" className="button button-secondary" onClick={() => { setSearch(""); navigate({ q: "" }); }}>عرض الطلبات</button> : null}
      </div> : null}

      <div className="ops-results">
        {operations.length > 0 ? (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: This labeled, horizontally scrollable table region must be keyboard-focusable.
          <section className="operations-table-wrap" aria-label="قائمة الطلبات؛ تمرير أفقي عند الحاجة" tabIndex={0}>
            <table className="operations-table ops-list-table">
              <caption className="visually-hidden">{selectedViewLabel}، خمسون طلبًا كحد أقصى في الصفحة</caption>
              <thead><tr>
                <th scope="col">المتجر</th>
                <th scope="col">الحالة</th>
                <RegistryColumnHeader label="الكابتن" active={pageCaptainFilter !== "all"} scope="page">
                  <label>الإسناد<select value={pageCaptainFilter} onChange={(event) => setPageCaptainFilter(event.target.value)}>
                    <option value="all">الكل</option><option value="assigned">مسند</option><option value="unassigned">غير مسند</option>
                  </select></label>
                </RegistryColumnHeader>
                <th scope="col">آخر تحديث</th>
                <RegistryColumnHeader label="المتابعة" active={pageReviewFilter !== "all"} scope="page">
                  <label>حالة المتابعة<select value={pageReviewFilter} onChange={(event) => setPageReviewFilter(event.target.value)}>
                    <option value="all">الجميع</option><option value="overdue">متعثر أو متأخر</option><option value="action">له إجراء متاح</option>
                  </select></label>
                </RegistryColumnHeader>
                <th scope="col">فتح الطلب</th>
              </tr></thead>
              <tbody>
                {visibleOperations.length === 0 ? <tr><td colSpan={6} className="catalog-table-state">لا توجد مطابقة في الصفحة الحالية. أزل مرشح الإسناد أو المتابعة.</td></tr> : null}
                {visibleOperations.map((item) => {
                  const age = operationalAge(item.state, item.updatedAt, ageClock || Date.now());
                  const stageAttention = operationalStageAttention(item.state, item.stageStartedAt, ageClock || Date.now(), item.preparationMinutes);
                  const needsReview = stageAttention ? stageAttention.needsReview : age.needsReview;
                  const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                  return <tr key={item.orderId} className={needsReview ? "ops-row-review" : undefined}>
                    <th scope="row">{item.storeName}<small className="muted ops-order-short-id" dir="ltr" title={item.orderId}>#{item.orderId.slice(-8)}</small></th>
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
                    <td><button type="button" className="ops-row-open" aria-label={(nextAction || needsReview ? "مراجعة" : "تفاصيل") + " طلب " + item.orderId.slice(-8) + " من " + item.storeName} onClick={() => openOrder(item.orderId)}>{nextAction || needsReview ? "مراجعة" : "تفاصيل"}</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
            <ul className="ops-mobile-orders" aria-label="طلبات الصفحة">
              {visibleOperations.map((item) => {
                const age = operationalAge(item.state, item.updatedAt, ageClock || Date.now());
                const stageAttention = operationalStageAttention(item.state, item.stageStartedAt, ageClock || Date.now(), item.preparationMinutes);
                const needsReview = stageAttention ? stageAttention.needsReview : age.needsReview;
                const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                return <li key={item.orderId} className={"ops-mobile-order" + (needsReview ? " ops-mobile-order-review" : "")}>
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
                    <button type="button" className="ops-row-open" aria-label={(nextAction || needsReview ? "مراجعة الطلب" : "تفاصيل الطلب") + " رقم " + item.orderId.slice(-8) + " من " + item.storeName} onClick={() => openOrder(item.orderId)}>{nextAction || needsReview ? "مراجعة الطلب" : "تفاصيل الطلب"}</button>
                  </div>
                </li>;
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات الطلبات" />
        </>}
      </CommandFrame>
    </section>
    </AdaptiveRecordWorkspace>
  );
}
