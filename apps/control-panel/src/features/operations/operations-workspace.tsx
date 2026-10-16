"use client";

import { captainAssignmentStateLabel, formatOrderDate, type OperatorOperationListItem, type OperatorOperationsSummary, orderStateLabel } from "@bthwani/dsh";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { RecordIndicator } from "../shared/record-indicator";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { operationalAge } from "./operational-age";
import { operationActionLabel, operationResponseMessage, resolveOperatorAction } from "./operator-actions";
import { OrderOperationDetail } from "./order-operation-detail";

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
  const fields = ["totalCount", "actionableCount", "awaitingDispatchCount", "activeCount", "deliveredCount"];
  return fields.every((field) => Number.isSafeInteger(item[field]) && Number(item[field]) >= 0 && Number(item[field]) <= Number(item.totalCount))
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
  const [ageClock, setAgeClock] = useState(() => Date.now());
  const [search, setSearch] = useState(searchFromUrl);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const loadSequence = useRef(0);

  useEffect(() => setSearch(searchFromUrl), [searchFromUrl]);
  useEffect(() => {
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
        || (body.summary !== undefined && !isRenderableSummary(body.summary))) {
        throw new Error("استجابة قائمة الطلبات غير صالحة. أعد المحاولة.");
      }
      setOperations(body.operations);
      setSummary(body.summary ?? null);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      if (!retainRows || (cause && typeof cause === "object" && "status" in cause && (cause.status === 401 || cause.status === 403))) { setOperations([]); setSummary(null); }
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
        onPrevious={selectedIndex > 0 ? () => setSelectedOrderId(operations[selectedIndex - 1]!.orderId) : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < operations.length - 1 ? () => setSelectedOrderId(operations[selectedIndex + 1]!.orderId) : undefined}
      >
        <OrderOperationDetail orderId={selectedOrderId} embedded onClose={closeSelected} onUpdated={() => void load(true)} />
      </AdaptiveRecordPanel> : null}>
    <section className="operations-workspace ops-center" aria-label="مركز متابعة الطلبات">
      <div className="ops-page-intro">
        <p>متابعة الطلبات والتعامل مع ما يحتاج تدخلك من مكان واحد.</p>
        <button type="button" className="button button-secondary ops-refresh" disabled={loading}
          onClick={() => void load(true)} aria-label="تحديث قائمة الطلبات">
          {loading ? "جارٍ التحديث…" : "تحديث"}
        </button>
      </div>

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
        <label className="ops-select-label">الحالة
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

      {hasSearch ? (
        <div className="ops-active-search"><span>البحث: {searchFromUrl}</span>
          <button type="button" onClick={() => { setSearch(""); navigate({ q: "" }); }}>مسح البحث ×</button>
        </div>
      ) : null}
      {error ? <div className="managed-status managed-status-warning" role="alert">
        <strong>{errorStatus === 403 ? "لا تملك صلاحية قراءة الطلبات" : "تعذر قراءة الطلبات"}</strong>
        <p>{error}</p><button className="button button-secondary" type="button" onClick={() => void load(true)} disabled={loading}>إعادة المحاولة</button>
      </div> : null}

      <section className="ops-status-summary" aria-label="مؤشرات نتائج الطلبات">
        <div className="ops-summary-caption">{summary ? <>كل النتائج المطابقة للبحث والمرشحات · آخر قراءة <time dateTime={summary.measuredAt}>{formatOrderDate(summary.measuredAt)}</time>{loading || error ? " · جارٍ التحديث أو تعذر تحديث القراءة" : ""}</> : "لم تتوفر إجماليات النتائج من الخدمة"}</div>
        <div className="ops-summary-grid">
          <div className="ops-summary ops-summary-review"><span>تحتاج قرارًا</span><strong>{summary?.actionableCount ?? "—"}</strong></div>
          <div className="ops-summary ops-summary-dispatch"><span>بانتظار كابتن</span><strong>{summary?.awaitingDispatchCount ?? "—"}</strong></div>
          <div className="ops-summary ops-summary-active"><span>قيد التنفيذ</span><strong>{summary?.activeCount ?? "—"}</strong></div>
          <div className="ops-summary ops-summary-delivered"><span>تم التسليم</span><strong>{summary?.deliveredCount ?? "—"}</strong></div>
        </div>
      </section>

      <div className="ops-list-heading">
        <div className="ops-list-name"><h2 id="operations-list-title">{selectedViewLabel}</h2>
          <span className="muted">{operations.length} طلب في هذه الصفحة{summary ? ` · ${summary.totalCount} إجمالي النتائج` : ""}{nextCursor ? " · المزيد في الصفحة التالية" : ""}</span>
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
              <thead><tr><th scope="col">المتجر</th><th scope="col">الحالة</th><th scope="col">الكابتن</th><th scope="col">آخر تحديث</th><th scope="col">المتابعة</th><th scope="col">إجراء</th></tr></thead>
              <tbody>
                {operations.map((item) => {
                  const age = operationalAge(item.state, item.updatedAt, ageClock);
                  const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                  return <tr key={item.orderId} className={age.needsReview ? "ops-row-review" : undefined}>
                    <th scope="row">{item.storeName}</th>
                    <td><span className={"status-badge status-" + item.state.toLowerCase()}>{orderStateLabel(item.state)}</span></td>
                    <td>{item.assignment ? <span className="ops-captain-cell">
                      <span>{captainAssignmentStateLabel(item.assignment.state)}</span>
                    </span> : <span className="muted">غير مسند</span>}</td>
                    <td><time dateTime={item.updatedAt}>{formatOrderDate(item.updatedAt)}</time></td>
                    <td><div className="ops-row-followup">
                      <span className={age.needsReview ? "operations-attention" : "muted"}>{age.label}</span>
                      {nextAction ? <RecordIndicator legend icon="review" label={operationActionLabel(nextAction)} tone="warning" /> : null}
                    </div></td>
                    <td><button type="button" className="ops-row-open" aria-label={"فتح طلب من " + item.storeName} onClick={() => setSelectedOrderId(item.orderId)}>فتح</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
            <ul className="ops-mobile-orders" aria-label="طلبات الصفحة">
              {operations.map((item) => {
                const age = operationalAge(item.state, item.updatedAt, ageClock);
                const nextAction = resolveOperatorAction({ state: item.state, assignment: item.assignment });
                return <li key={item.orderId} className={"ops-mobile-order" + (age.needsReview ? " ops-mobile-order-review" : "")}>
                  <div className="ops-mobile-order-heading">
                    <strong>{item.storeName}</strong>
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
                    <button type="button" className="ops-row-open" aria-label={"فتح طلب من " + item.storeName} onClick={() => setSelectedOrderId(item.orderId)}>فتح الطلب</button>
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
