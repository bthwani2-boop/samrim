"use client";

import { captainAssignmentStateLabel, formatOrderDate, type OperatorOperationListItem, orderStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { responseMessage } from "../access/identity-error-message";
import "./operations-workspace.module.css";

type LaneId = "orders" | "attention" | "dispatch" | "execution" | "exceptions" | "history";
type Lane = Readonly<{ id: LaneId; label: string; summary: string }>;
type SubLane = Readonly<{ id: string; label: string; state: string }>;

const defaultLane: Lane = { id: "orders", label: "الطلبات", summary: "جميع الطلبات ذات الصلة التشغيلية" };
const lanes: ReadonlyArray<Lane> = [
  defaultLane,
  { id: "attention", label: "تحتاج قرارًا", summary: "أعمال تسمح حالتها بإجراء من المشغل" },
  { id: "dispatch", label: "التوزيع", summary: "طلبات جاهزة لإسناد كابتن" },
  { id: "execution", label: "التنفيذ الجاري", summary: "تقدم الإسناد وعهدة الكابتن" },
  { id: "exceptions", label: "الاستثناءات والاستعادة", summary: "حالات تعثر التسليم القابلة للاستعادة" },
  { id: "history", label: "السجل والحالات النهائية", summary: "طلبات وصلت إلى حالة نهائية" },
];

const subLanes: Partial<Record<LaneId, ReadonlyArray<SubLane>>> = {
  execution: [
    { id: "assigned", label: "إسناد الكابتن", state: "CAPTAIN_ASSIGNED" },
    { id: "custody", label: "في عهدة الكابتن", state: "IN_CUSTODY" },
  ],
  history: [
    { id: "delivered", label: "تم التسليم", state: "DELIVERED" },
    { id: "picked-up", label: "استلام من المتجر", state: "PICKED_UP" },
    { id: "rejected", label: "مرفوضة", state: "REJECTED" },
    { id: "cancelled", label: "ملغاة", state: "CANCELLED" },
  ],
};

export function OperationsWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const params = new URLSearchParams(queryString);
  const requestedLane = params.get("lane") as LaneId | null;
  const lane = lanes.find((item) => item.id === requestedLane) ?? defaultLane;
  const laneSubTabs = subLanes[lane.id] ?? [];
  const subLane = laneSubTabs.find((item) => item.id === params.get("sub")) ?? laneSubTabs[0];
  const state = lane.id === "dispatch" ? "READY_FOR_DISPATCH" : lane.id === "exceptions" ? "DELIVERY_FAILED" : lane.id === "execution" || lane.id === "history" ? subLane?.state ?? "" : "";
  const actionableOnly = lane.id === "attention";
  const searchFromUrl = (params.get("q") ?? "").trim().slice(0, 128);
  const sort = params.get("sort") === "updated_asc" ? "updated_asc" : "updated_desc";
  const cursor = params.get("cursor") ?? "";
  const hasSearch = Boolean(searchFromUrl);

  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [search, setSearch] = useState(searchFromUrl);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const loadSequence = useRef(0);
  const lanesNavigationRef = useRef<HTMLElement>(null);

  useEffect(() => setSearch(searchFromUrl), [searchFromUrl]);

  const navigate = useCallback((changes: Readonly<{ lane?: LaneId; sub?: string; q?: string; sort?: string; cursor?: string }>) => {
    const next = new URLSearchParams(queryString);
    if (changes.lane) next.set("lane", changes.lane);
    if (changes.sub) next.set("sub", changes.sub);
    else if (changes.lane) next.delete("sub");
    if (changes.q !== undefined) {
      if (changes.q) next.set("q", changes.q);
      else next.delete("q");
    }
    if (changes.sort) {
      if (changes.sort === "updated_desc") next.delete("sort");
      else next.set("sort", changes.sort);
    }
    if (changes.cursor) next.set("cursor", changes.cursor);
    else next.delete("cursor");
    const serialized = next.toString();
    router.push(pathname + (serialized ? `?${serialized}` : ""), { scroll: false });
  }, [pathname, queryString, router]);

  const viewHref = useCallback((nextLane: LaneId, nextSub?: string) => {
    const next = new URLSearchParams(queryString);
    next.set("lane", nextLane);
    if (nextSub) next.set("sub", nextSub);
    else next.delete("sub");
    next.delete("cursor");
    const serialized = next.toString();
    return pathname + (serialized ? `?${serialized}` : "");
  }, [pathname, queryString]);

  const orderHref = useCallback((id: string) => {
    const next = new URLSearchParams(queryString);
    next.set("tab", "overview");
    const serialized = next.toString();
    const base = `/operations/${encodeURIComponent(id)}`;
    return serialized ? `${base}?${serialized}` : base;
  }, [queryString]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setOperations([]);
    setNextCursor("");
    setError("");
    setErrorStatus(0);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (state) query.set("state", state);
      if (actionableOnly) query.set("actionableOnly", "true");
      if (searchFromUrl) query.set("q", searchFromUrl);
      if (sort !== "updated_desc") query.set("sort", sort);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/operations?${query.toString()}`, { cache: "no-store" });
      if (sequence !== loadSequence.current) return;
      if (!response.ok) {
        setErrorStatus(response.status);
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as { operations?: ReadonlyArray<OperatorOperationListItem>; nextCursor?: string };
      if (sequence !== loadSequence.current) return;
      setOperations(body.operations ?? []);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذر قراءة مركز العمليات.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [actionableOnly, cursor, searchFromUrl, sort, state]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    lanesNavigationRef.current?.querySelector<HTMLElement>(`[data-ops-lane="${lane.id}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [lane.id]);

  return (
    <section className="operations-workspace" aria-labelledby="operations-list-title">
      <nav ref={lanesNavigationRef} className="operations-lanes" aria-label="مسارات مركز العمليات">
        {lanes.map((item) => (
          <Link key={item.id} href={viewHref(item.id, (subLanes[item.id] ?? [])[0]?.id)} aria-current={item.id === lane.id ? "page" : undefined} data-ops-lane={item.id} className={item.id === lane.id ? "operations-lane is-active" : "operations-lane"}>
            {item.label}
          </Link>
        ))}
      </nav>

      {laneSubTabs.length > 0 ? (
        <nav className="operations-sub-lanes" aria-label={`مسارات ${lane.label}`}>
          {laneSubTabs.map((item) => (
            <Link key={item.id} href={viewHref(lane.id, item.id)} aria-current={item.id === subLane?.id ? "page" : undefined} className={item.id === subLane?.id ? "operations-sub-lane is-active" : "operations-sub-lane"}>
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="operations-view-heading">
        <div>
          <h2 id="operations-list-title">{laneSubTabs.length && subLane ? subLane.label : lane.label}</h2>
          <p>{lane.summary}</p>
        </div>
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "جارٍ القراءة…" : "إعادة القراءة"}
        </button>
      </div>

      <div className="operations-toolbar">
        <search className="operations-search" aria-label="البحث في الطلبات">
          <form className="operations-search-form" onSubmit={(event) => { event.preventDefault(); navigate({ q: search.trim().slice(0, 128) }); }}>
            <label className="field-label" htmlFor="operations-search">رقم الطلب أو اسم المتجر
              <input id="operations-search" type="search" value={search} maxLength={128} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن طلب أو متجر" />
            </label>
            <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          </form>
        </search>
        <label className="field-label operations-sort" htmlFor="operations-sort">ترتيب التحديث
          <select id="operations-sort" value={sort} onChange={(event) => navigate({ sort: event.target.value })}>
            <option value="updated_desc">الأحدث أولًا</option>
            <option value="updated_asc">الأقدم أولًا</option>
          </select>
        </label>
      </div>

      {hasSearch ? <fieldset className="active-filter-chips"><legend className="visually-hidden">عوامل البحث النشطة</legend><button type="button" className="filter-chip" onClick={() => { setSearch(""); navigate({ q: "" }); }}>البحث: {searchFromUrl} <span aria-hidden="true">×</span><span className="visually-hidden">مسح البحث</span></button></fieldset> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>{errorStatus === 403 ? "لا تملك صلاحية قراءة هذا المسار" : "تعذر قراءة الطلبات"}</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>إعادة المحاولة</button></div> : null}
      {loading && operations.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة {lane.label}</strong></div> : null}
      {!loading && !error && operations.length === 0 ? <div className="collection-state"><strong>{hasSearch ? "لا توجد نتائج تطابق البحث" : "لا توجد طلبات في هذا المسار"}</strong><p>{hasSearch ? "امسح البحث لعرض بقية السجلات." : lane.summary}</p></div> : null}

      {operations.length > 0 ? (
        <section className="operations-table-wrap" aria-label="جدول الطلبات؛ يمكن تمريره أفقيًا عند ضيق الشاشة">
          <table className="operations-table">
            <caption className="visually-hidden">{laneSubTabs.length && subLane ? subLane.label : lane.label}</caption>
            <thead><tr><th scope="col">الطلب</th><th scope="col">المتجر</th><th scope="col">الحالة</th><th scope="col">الكابتن</th><th scope="col">آخر تحديث</th><th scope="col">المتابعة</th></tr></thead>
            <tbody>
              {operations.map((item) => (
                <tr key={item.orderId}>
                  <th scope="row"><Link href={orderHref(item.orderId)}><bdi dir="ltr">{item.orderId}</bdi></Link></th>
                  <td>{item.storeName}</td>
                  <td><span className={`status-badge status-${item.state.toLowerCase()}`}>{orderStateLabel(item.state)}</span></td>
                  <td>{item.assignment ? captainAssignmentStateLabel(item.assignment.state) : <span className="muted">غير مسند</span>}</td>
                  <td><time dateTime={item.updatedAt}>{formatOrderDate(item.updatedAt)}</time></td>
                  <td>{lane.id === "attention" ? <span className="operations-attention">يتطلب قرارًا</span> : <span className="muted">فتح مساحة الطلب</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {nextCursor ? <div className="operations-pagination"><span>تُقرأ السجلات على صفحات محدودة.</span><button type="button" className="button button-secondary" onClick={() => navigate({ cursor: nextCursor })} disabled={loading}>الصفحة التالية</button></div> : null}
    </section>
  );
}
