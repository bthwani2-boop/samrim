"use client";

import { formatMoney, type PartnerFinancialActivity, type PartnerFinancialActivityPage } from "@bthwani/dsh";
import Link from "next/link";
import { useReactTable, getCoreRowModel, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import "./partner-financial-register.css";

type Filters = { storeId: string; kind: string; status: string; paymentMethod: string; period: string; search: string };
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
const select = (name: string, options: string[][], value: string, update: (value: string) => void) =>
  <label className="pfr-field"><span>{name}</span><select value={value} onChange={(event) => update(event.target.value)}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>;

export function PartnerFinancialRegister({ partnerActorId, storeId = "", compact = false }: { partnerActorId: string; storeId?: string; compact?: boolean }) {
  const [filters, setFilters] = useState<Filters>(defaults);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<PartnerFinancialActivityPage | null>(null);
  const [items, setItems] = useState<PartnerFinancialActivity[]>([]);
  const [cursor, setCursor] = useState("");
  const [expanded, setExpanded] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Filtering, ordering and pagination belong to DSH, not to the local page.
  const columns = useMemo<ColumnDef<PartnerFinancialActivity>[]>(() => [
    { accessorKey: "createdAt", header: "Date" },
    { accessorKey: "kind", header: "Activity" },
    { accessorKey: "storeName", header: "Store" },
    { accessorKey: "grossMinor", header: "Gross" },
    { accessorKey: "commissionMinor", header: "Commission" },
    { accessorKey: "amountMinor", header: "Amount" },
    { accessorKey: "status", header: "Status" },
  ], []);
  const table = useReactTable({
    data: items,
    columns,
    getRowId: (item) => item.kind + ":" + item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });
  const tableRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualEnabled = tableRows.length > 60 && !expanded;
  const rowVirtualizer = useVirtualizer({
    count: virtualEnabled ? tableRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 62,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const visibleRows = virtualEnabled ? virtualRows.map((row) => tableRows[row.index]).filter((row) => row !== undefined) : tableRows;
  const topPadding = virtualEnabled ? (virtualRows[0]?.start ?? 0) : 0;
  const bottomPadding = virtualEnabled ? Math.max(0, rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0)) : 0;

  useEffect(() => {
    const timeout = setTimeout(() => setFilters((current) => ({ ...current, search: search.trim() })), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ partnerActorId, limit: compact ? "5" : "25", ...periodRange(filters.period) });
    if (storeId) qs.set("storeId", storeId);
    for (const field of ["storeId", "kind", "status", "paymentMethod", "search"] as const) if (filters[field] && !(storeId && field === "storeId")) qs.set(field, filters[field]);
    setLoading(true); setItems([]); setCursor(""); setError(""); setExpanded("");
    void fetch("/api/finance/partner-activity?" + qs, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذرت قراءة الحركات المالية (" + response.status + ")");
        return await response.json() as PartnerFinancialActivityPage;
      }).then((result) => { setData(result); setItems([...result.items]); setCursor(result.nextCursor ?? ""); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذرت قراءة الحركات"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, partnerActorId, storeId, compact]);
  const update = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  async function more() {
    if (!cursor || busy) return;
    setBusy(true); setError("");
    try {
      const qs = new URLSearchParams({ partnerActorId, limit: "25", cursor, ...periodRange(filters.period) });
      if (storeId) qs.set("storeId", storeId);
      for (const field of ["storeId", "kind", "status", "paymentMethod", "search"] as const) if (filters[field] && !(storeId && field === "storeId")) qs.set(field, filters[field]);
      const response = await fetch("/api/finance/partner-activity?" + qs, { cache: "no-store" });
      if (!response.ok) throw new Error("تعذرت قراءة الصفحة التالية");
      const page = await response.json() as PartnerFinancialActivityPage;
      setItems((previous) => [...previous, ...page.items.filter((item) => !previous.some((old) => old.kind === item.kind && old.id === item.id))]);
      setCursor(page.nextCursor ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذرت قراءة الصفحة"); }
    finally { setBusy(false); }
  }
  return <section className="pfr-root" aria-label="الحركات المالية للشريك">
    <div className="pfr-head"><div><h3>الكشف المالي للمتاجر</h3><p>حركات موثقة من الدفتر المالي WLT، وليس تقديرات من الطلبات</p></div>
      {compact ? <Link href={"/finance/partner-earnings?partnerActorId=" + encodeURIComponent(partnerActorId)} className="button button-secondary">فتح الإدارة المالية</Link> : null}
    </div>
    {!compact ? <div className="pfr-toolbar">
      <label className="pfr-field pfr-search"><span>بحث برقم الطلب أو الصرف</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" maxLength={128} placeholder="ابحث في جميع الحركات..." /></label>
      {select("الفترة", [["today","اليوم"],["week","7 أيام"],["month","هذا الشهر"],["all","كل الفترات"]], filters.period, (v) => update("period", v))}
      {!storeId ? select("المتجر", [["","كل المتاجر"], ...((data?.stores ?? []).map((store) => [store.storeId, store.storeName]))], filters.storeId, (v) => update("storeId", v)) : null}
      {select("نوع الحركة", kindOptions, filters.kind, (v) => update("kind", v))}
      {select("الحالة", statusOptions, filters.status, (v) => update("status", v))}
      {select("الدفع", paymentOptions, filters.paymentMethod, (v) => update("paymentMethod", v))}
      <button className="button button-quiet" type="button" onClick={() => { setFilters(defaults); setSearch(""); }}>مسح الفلاتر</button>
    </div> : null}
    {error ? <p className="state-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted" role="status">جارٍ قراءة السجل المالي…</p> : null}
    {!loading ? <div ref={scrollRef} className={virtualEnabled ? "pfr-table-wrap pfr-virtualized" : "pfr-table-wrap"}><table className="data-table pfr-table"><caption className="sr-only">قائمة الحركات المالية المسندة للمتاجر</caption>
      <thead><tr><th scope="col">التاريخ والمرجع</th><th scope="col">نوع الحركة</th><th scope="col">المتجر / الدفع</th><th scope="col">المنتجات</th><th scope="col">العمولة</th><th scope="col">الصافي أو المستحق</th><th scope="col">الحالة</th></tr></thead>
      <tbody>
        {virtualEnabled && topPadding > 0 ? <tr className="pfr-spacer"><td colSpan={7} style={{ height: topPadding }} /></tr> : null}
        {visibleRows.map((row) => <FragmentRow key={row.id} index={virtualEnabled ? row.index : undefined} measure={virtualEnabled ? rowVirtualizer.measureElement : undefined} item={row.original} open={expanded === row.id} toggle={() => setExpanded((current) => current === row.id ? "" : row.id)} />)}
        {virtualEnabled && bottomPadding > 0 ? <tr className="pfr-spacer"><td colSpan={7} style={{ height: bottomPadding }} /></tr> : null}
        {!items.length ? <tr><td colSpan={7}>لا توجد حركات مالية مطابقة لهذه الفلاتر.</td></tr> : null}
      </tbody>
    </table></div> : null}
    <div className="pfr-bottom"><span className="muted">المعروض: {items.length.toLocaleString("ar-YE")}{cursor ? "+" : ""} حركة · التصفية على جميع السجلات</span>
      {!compact && cursor ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void more()}>{busy ? "جارٍ التحميل..." : "تحميل المزيد"}</button> : null}</div>
  </section>;
}
function FragmentRow({ item, open, toggle, measure, index }: { item: PartnerFinancialActivity; open: boolean; toggle: () => void; measure?: ((element: Element | null) => void) | undefined; index?: number | undefined }) {
  return <>
    <tr data-index={index} ref={measure} className={open ? "pfr-active-row" : ""}>
      <td><button type="button" className="pfr-open" aria-expanded={open} onClick={toggle}><strong>{dateLabel(item.createdAt)}</strong><small dir="auto">#{item.id}</small></button></td>
      <td>{activityType(item)}</td><td>{item.storeName}<small className="pfr-block-muted">{item.paymentMethod ? ({ CASH_ON_DELIVERY: "نقدي عند التسليم", CASH_AT_STORE: "نقدي للمتجر", WALLET: "محفظة", MIXED: "مختلط" } as Record<string,string>)[item.paymentMethod] ?? item.paymentMethod : "—"}</small></td>
      <td>{item.kind === "PAYOUT" ? "—" : formatMoney(item.grossMinor, item.currency)}</td><td>{item.kind === "PAYOUT" ? "—" : formatMoney(item.commissionMinor, item.currency)}</td>
      <td className="pfr-money"><strong>{currency(item)}</strong></td><td><span className="pfr-state">{stateLabel(item)}</span></td>
    </tr>
    {open ? <tr><td colSpan={7}><div className="pfr-detail"><div><strong>مرجع العملية</strong><span dir="auto">{item.id}</span></div><div><strong>المتجر</strong><span>{item.storeName}</span></div><div><strong>نوع القيد</strong><span>{item.direction === "RECEIVABLE" ? "ذمة عمولة، ليست خصمًا من رصيد المتجر" : item.direction === "HOLD" ? "حجز مستحق، لم يُصرف بعد" : item.direction === "DEBIT" ? "صرف مكتمل" : item.direction === "NONE" ? "لا أثر مباشر على المحفظة" : "إضافة مثبتة لرصيد المستحقات"}</span></div>{item.offsetMinor ? <div><strong>مقاصة عمولة</strong><span>{formatMoney(item.offsetMinor, item.currency)}</span></div> : null}{item.ledgerTransactionId ? <div><strong>مرجع القيد المحاسبي</strong><span dir="auto">{item.ledgerTransactionId}</span></div> : null}</div></td></tr> : null}
  </>;
}
