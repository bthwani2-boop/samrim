"use client";

import { type CashCustodyRegistryResponse, formatMoney } from "@bthwani/dsh";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { responseMessage } from "../access/identity-error-message";
import "./cash-custody-workspace.module.css";

type Sort = "collected_asc" | "collected_desc";
export type CashCustodyInitialQuery = Readonly<{ search: string; sort: Sort; cursor: string }>;
type Props = Readonly<{ initialQuery: CashCustodyInitialQuery }>;

function buildHref(pathname: string, query: CashCustodyInitialQuery) {
  const params = new URLSearchParams({ sort: query.sort });
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  return `${pathname}?${params.toString()}`;
}

export function CashCustodyWorkspace({ initialQuery }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "/finance/cash-custody";
  const cursorHistory = useRef<string[]>([]);
  const currentCursor = useRef(initialQuery.cursor);
  const requestedCursor = useRef<string | null>(null);
  const [search, setSearch] = useState(initialQuery.search);
  const [sort, setSort] = useState<Sort>(initialQuery.sort);
  const [registry, setRegistry] = useState<CashCustodyRegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const registryController = useRef<AbortController | null>(null);

  const navigate = (query: CashCustodyInitialQuery, replace = false) => {
    const href = buildHref(pathname, query);
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };

  const loadRegistry = useCallback(async () => {
    registryController.current?.abort();
    const controller = new AbortController();
    registryController.current = controller;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "50", sort: initialQuery.sort });
    if (initialQuery.search) params.set("search", initialQuery.search);
    if (initialQuery.cursor) params.set("cursor", initialQuery.cursor);
    try {
      const response = await fetch(`/api/finance/cash-custody?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = await response.json() as CashCustodyRegistryResponse;
      setRegistry(body);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر قراءة سجل النقد المحصل.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [initialQuery.cursor, initialQuery.search, initialQuery.sort]);

  useEffect(() => {
    setSearch(initialQuery.search);
    setSort(initialQuery.sort);
    if (requestedCursor.current === initialQuery.cursor) {
      requestedCursor.current = null;
    } else if (currentCursor.current !== initialQuery.cursor) {
      const priorIndex = cursorHistory.current.lastIndexOf(initialQuery.cursor);
      cursorHistory.current = priorIndex >= 0
        ? cursorHistory.current.slice(0, priorIndex)
        : [...cursorHistory.current, currentCursor.current];
    }
    currentCursor.current = initialQuery.cursor;

    void loadRegistry();
    return () => registryController.current?.abort();
  }, [initialQuery.cursor, initialQuery.search, initialQuery.sort, loadRegistry]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    cursorHistory.current = [];
    currentCursor.current = "";
    requestedCursor.current = "";
    setError("");
    navigate({ search: search.trim().slice(0, 128), sort, cursor: "" });
  };

  const nextPage = () => {
    const nextCursor = registry?.nextCursor;
    if (!nextCursor) return;
    cursorHistory.current = [...cursorHistory.current, currentCursor.current];
    currentCursor.current = nextCursor;
    requestedCursor.current = nextCursor;
    navigate({ ...initialQuery, cursor: nextCursor });
  };

  const previousPage = () => {
    const previous = cursorHistory.current.pop();
    if (previous === undefined) return;
    currentCursor.current = previous;
    requestedCursor.current = previous;
    navigate({ ...initialQuery, cursor: previous });
  };

  return (
    <section className="cash-custody-workspace" aria-labelledby="cash-custody-title">
      <div className="finance-summary-grid">
        <article className="finance-summary-card">
          <p className="eyebrow">إجمالي السجل المطابق</p>
          <strong dir="ltr"><bdi>{formatMoney(registry?.totalAmountMinor ?? 0, "YER")}</bdi></strong>
          <span>التزامات نقدية مفتوحة ضمن المرشحات الحالية</span>
        </article>
        <article className="finance-summary-card">
          <p className="eyebrow">السجلات المطابقة</p>
          <strong>{(registry?.totalItems ?? 0).toLocaleString("ar-YE")}</strong>
          <span>إجمالي النتائج على جميع الصفحات</span>
        </article>
      </div>

      <div className="finance-boundary-note" role="note">
        <strong>حدود هذه المساحة</strong>
        <p>البيانات من WLT، وتعرض فقط نقد COD الذي حصّله الكابتن ولم تسجل له حوالة. تسجيل الحوالة وإغلاق العهدة يتمان من مسار الكابتن الكانوني.</p>
      </div>

      <div className="finance-toolbar">
        <h2 id="cash-custody-title">النقد المحصل عند التسليم</h2>
        <button type="button" className="button button-secondary" onClick={() => void loadRegistry()} disabled={loading}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
      </div>

      <form className="cash-custody-filters" onSubmit={applyFilters}>
        <label className="field-label" htmlFor="cash-custody-search">مرجع التحصيل أو معرّف الكابتن<input id="cash-custody-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={128} /></label>
        <label className="field-label" htmlFor="cash-custody-sort">ترتيب وقت التحصيل<select id="cash-custody-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="collected_asc">الأقدم أولًا</option><option value="collected_desc">الأحدث أولًا</option></select></label>
        <button className="button button-secondary" type="submit" disabled={loading}>تطبيق البحث</button>
      </form>

      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة سجل حفظ النقد</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void loadRegistry()} disabled={loading}>إعادة المحاولة</button></div> : null}
      {loading && !registry ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة سجل النقد</strong><p>نطلب صفحة محدودة من السجل المالي الكانوني.</p></div> : null}

      {registry ? <>
        <p className="muted" aria-live="polite">صفحة {registry.items.length.toLocaleString("ar-YE")} سجلًا من أصل {registry.totalItems.toLocaleString("ar-YE")}{loading ? " · جارٍ التحديث" : ""}</p>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <caption className="visually-hidden">سجل النقد المفتوح في عهدة الكباتن</caption>
            <thead><tr><th scope="col">مرجع التحصيل</th><th scope="col">الكابتن</th><th scope="col">المبلغ</th><th scope="col">وقت التحصيل</th></tr></thead>
            <tbody>{registry.items.map((item) => <tr key={item.paymentIntentId}><th scope="row"><bdi dir="ltr">{item.externalReference}</bdi></th><td><bdi dir="ltr">{item.captainActorId}</bdi></td><td dir="ltr"><bdi>{formatMoney(item.amountMinor, item.currency)}</bdi></td><td><time dateTime={item.collectedAt}>{new Date(item.collectedAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td></tr>)}</tbody>
          </table>
          {registry.items.length === 0 ? <p className="collection-state"><strong>لا توجد نتائج مطابقة</strong><span>لا يوجد نقد مفتوح يطابق البحث الحالي.</span></p> : null}
        </div>
        <nav className="cash-custody-pagination" aria-label="صفحات سجل النقد المحصل">
          <button className="button button-quiet" type="button" onClick={previousPage} disabled={loading || cursorHistory.current.length === 0}>السجلات السابقة</button>
          <button className="button button-quiet" type="button" onClick={nextPage} disabled={loading || !registry.nextCursor}>السجلات التالية</button>
        </nav>
      </> : null}
    </section>
  );
}
