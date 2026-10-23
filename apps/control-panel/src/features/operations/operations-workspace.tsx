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
import { operationActionLabel, operationResponseMessage, resolveOperatorAction } from "./operator-actions";
import { OrderOperationDetail } from "./order-operation-detail";
import { CancellationRequestInbox } from "./cancellation-request-inbox";
import { CustomerContactQueue } from "./customer-contact-queue";

type View = "all" | "attention" | "dispatch" | "delivered";
type Change = Readonly<{ view?: View; state?: string; q?: string; sort?: string }>;

const views: ReadonlyArray<Readonly<{ id: View; label: string }>> = [
  { id: "all", label: "جميع الطلبات" },
  { id: "attention", label: "تحتاج قرارًا" },
  { id: "dispatch", label: "بانتظار كابتن" },
  { id: "delivered", label: "تم التسليم" },
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
    : oldState === "DELIVERED" ? "delivered" : "all";
  const preciseState = params.get("state") ?? (view === "all" ? oldState : "");
  const state = preciseState || (view === "dispatch" ? "READY_FOR_DISPATCH" : view === "delivered" ? "DELIVERED" : "");
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
    && (pageReviewFilter === "all" || (pageReviewFilter === "overdue" ? operationalAge(item.state, item.updatedAt, ageClock || Date.parse(item.updatedAt)).needsReview : Boolean(resolveOperatorAction({ state: item.state, assignment: item.assignment }))))
  );
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [cancellationInboxVersion, setCancellationInboxVersion] = useState(0);
  const loadSequence = useRef(0);

  useEffect(() => setSearch(searchFromUrl), [searchFromUrl]);
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
    if (nextView === "all") next.delete("view");
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
    if (!cursorPage.ready || loading || view === "delivered") return;
    const timer = setInterval(() => {
      if (!document.hidden) void load(true);
    }, 60_000);
    return () => clearInterval(timer);
  }, [cursorPage.ready, load, loading, view]);

  const overdueOnPage = operations.filter((item) => operationalAge(item.state, item.updatedAt, ageClock || Date.parse(item.updatedAt)).needsReview).length;
  const hasSearch = Boolean(searchFromUrl);
  const selectedFilter = preciseState || (view === "attention" ? "attention" : view === "dispatch" ? "READY_FOR_DISPATCH" : view === "delivered" ? "DELIVERED" : "");
  const selectedViewLabel = preciseState ? specificStates.find((item) => item.value === preciseState)?.label ?? preciseState
    : views.find((item) => item.id === view)?.label ?? "جميع الطلبات";

  const selectedIndex = operations.findIndex((item) => item.orderId === selectedOrderId);
  const closeSelected = () => setSelectedOrderId("");

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
          if (previous) setSelectedOrderId(previous.orderId);
        } : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < operations.length - 1 ? () => {
          const next = operations[selectedIndex + 1];
          if (next) setSelectedOrderId(next.orderId);
        } : undefined}
      >
        <OrderOperationDetail orderId={selectedOrderId} embedded onClose={closeSelected} onUpdated={() => {setCancellationInboxVersion(v => v+1); void load(true)}} />
      </AdaptiveRecordPanel> : null}>
    <section className="operations-workspace ops-center" aria-label="مركز متابعة الطلبات">
      {(view === "all" || view === "attention") ? <CustomerContactQueue onOpenOrder={setSelectedOrderId} refreshVersion={cancellationInboxVersion} /> : null}
      <CancellationRequestInbox onOpenOrder={setSelectedOrderId} refreshVersion={cancellationInboxVersion} />
      <div className="ops-tools">
        <search className="ops-search" aria-label="البحث في الطلبات">
          <form noValidate onSubmit={(event) => {
            event.preventDefault();
            navigate({ view: "all", state: "", q: search.trim().slice(0, 128) });
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
                navigate({ view: chosen === "attention" ? "attention" : "all", state: chosen === "attention" ? "" : chosen });
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

      <section className="ops-status-summary" aria-label="أولوية متابعة الطلبات">
        <div className="ops-summary-grid">
          {([
            { key: "attention", label: "تحتاج قرارًا", count: summary?.actionableCount, className: "ops-summary-review" },
            { key: "dispatch", label: "بانتظار كابتن", count: summary?.awaitingDispatchCount, className: "ops-summary-dispatch" },
            { key: "all", label: "قيد التنفيذ", count: summary?.activeCount, className: "ops-summary-active" },
          ] as const).filter((item) => item.count === undefined || item.count > 0).map((item) =>
            <button key={item.key} type="button" className={"ops-summary " + item.className}
              aria-pressed={view === item.key && !preciseState}
              onClick={() => navigate({ view: item.key, state: "" })}>
              <span>{item.label}</span>
              <strong>{item.count === undefined ? "—" : item.count.toLocaleString("ar-YE")}</strong>
            </button>
          )}
          <button type="button" className="ops-summary ops-summary-all"
            aria-pressed={view === "all" && !preciseState}
            onClick={() => navigate({ view: "all", state: "" })}>
            <span>كل الطلبات</span><strong>{summary ? summary.totalCount.toLocaleString("ar-YE") : "—"}</strong>
          </button>
        </div>
        {summary ? <p className="ops-summary-caption">إجماليات من الخدمة للبحث والمرشحات الحالية · <time dateTime={summary.measuredAt}>{formatOrderDate(summary.measuredAt)}</time></p> : null}
        {summary && summary.inCustodyOrderCount > 0 ? <p className="ops-summary-caption" role="status">عهدة الكباتن الجارية: {summary.inCustodyOrderCount.toLocaleString("ar-YE")} طلب · إجمالي قيم الطلبات: {summary.inCustodyOrderValueMinor.toLocaleString("ar-YE")} ريال — مؤشر متابعة، وليس ضمانًا ماليًا.</p> : null}
      </section>

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
                  const age = operationalAge(item.state, item.updatedAt, ageClock || Date.parse(item.updatedAt));
                  const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                  return <tr key={item.orderId} className={age.needsReview ? "ops-row-review" : undefined}>
                    <th scope="row">{item.storeName}<small className="muted ops-order-short-id" dir="ltr" title={item.orderId}>#{item.orderId.slice(-8)}</small></th>
                    <td><span className={"status-badge status-" + item.state.toLowerCase()}>{orderStateLabel(item.state)}</span></td>
                    <td>{item.assignment ? <span className="ops-captain-cell">
                      <span>{captainAssignmentStateLabel(item.assignment.state)}</span>
                    </span> : <span className="muted">غير مسند</span>}</td>
                    <td><time dateTime={item.updatedAt}>{formatOrderDate(item.updatedAt)}</time></td>
                    <td><div className="ops-row-followup">
                      <span className={age.needsReview ? "operations-attention" : "muted"}>{age.label}</span>
                      {nextAction ? <RecordIndicator legend icon="review" label={operationActionLabel(nextAction)} tone="warning" /> : null}
                    </div></td>
                    <td><button type="button" className="ops-row-open" aria-label={(nextAction || age.needsReview ? "مراجعة" : "تفاصيل") + " طلب " + item.orderId.slice(-8) + " من " + item.storeName} onClick={() => setSelectedOrderId(item.orderId)}>{nextAction || age.needsReview ? "مراجعة" : "تفاصيل"}</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
            <ul className="ops-mobile-orders" aria-label="طلبات الصفحة">
              {visibleOperations.map((item) => {
                const age = operationalAge(item.state, item.updatedAt, ageClock || Date.parse(item.updatedAt));
                const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                return <li key={item.orderId} className={"ops-mobile-order" + (age.needsReview ? " ops-mobile-order-review" : "")}>
                  <div className="ops-mobile-order-heading">
                    <strong>{item.storeName}</strong><small className="muted ops-order-short-id" dir="ltr" title={item.orderId}>#{item.orderId.slice(-8)}</small>
                  </div>
                  <div className="ops-mobile-order-status">
                    <span className={"status-badge status-" + item.state.toLowerCase()}>{orderStateLabel(item.state)}</span>
                    <span className="ops-mobile-order-captain">{item.assignment ? captainAssignmentStateLabel(item.assignment.state) : "غير مسند"}</span>
                  </div>
                  <div className="ops-mobile-order-followup">
                    <span className={age.needsReview ? "operations-attention" : "muted"}>{age.label}</span>
                    {nextAction ? <RecordIndicator legend icon="review" label={operationActionLabel(nextAction)} tone="warning" /> : null}
                  </div>
                  <div className="ops-mobile-order-bottom">
                    <time dateTime={item.updatedAt}>آخر تحديث: {formatOrderDate(item.updatedAt)}</time>
                    <button type="button" className="ops-row-open" aria-label={(nextAction || age.needsReview ? "مراجعة الطلب" : "تفاصيل الطلب") + " رقم " + item.orderId.slice(-8) + " من " + item.storeName} onClick={() => setSelectedOrderId(item.orderId)}>{nextAction || age.needsReview ? "مراجعة الطلب" : "تفاصيل الطلب"}</button>
                  </div>
                </li>;
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading} label="صفحات الطلبات" />
    </section>
    </AdaptiveRecordWorkspace>
  );
}
