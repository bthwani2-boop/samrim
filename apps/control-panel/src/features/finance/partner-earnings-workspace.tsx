"use client";

import {
  financialProfileStateLabel,
  formatMoney,
  settlementPeriodLabel,
  type PartnerCommissionReceivableRegistryResponse,
  type PartnerCommissionRemittanceResponse,
  type PartnerFinancialSummary,
} from "@bthwani/dsh";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import styles from "./partner-earnings.module.css";

type Sort = "actor_asc" | "actor_desc";
export type PartnerEarningsInitialQuery = Readonly<{
  search: string;
  sort: Sort;
  cursor: string;
  partnerActorId: string;
}>;
type PendingRemittance = Readonly<{
  amountMinor: number;
  remittanceReference: string;
  evidenceReference: string;
  idempotencyKey: string;
  correlationId: string;
}>;
type Props = Readonly<{ initialQuery: PartnerEarningsInitialQuery }>;

function buildHref(pathname: string, query: PartnerEarningsInitialQuery) {
  const params = new URLSearchParams({ sort: query.sort });
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.partnerActorId) params.set("partnerActorId", query.partnerActorId);
  return `${pathname}?${params.toString()}`;
}

function readError(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export function PartnerEarningsWorkspace({ initialQuery }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "/finance/partner-commission-receivables";
  const cursorHistory = useRef<string[]>([]);
  const currentCursor = useRef(initialQuery.cursor);
  const requestedCursor = useRef<string | null>(null);
  const pendingByPartner = useRef(new Map<string, PendingRemittance>());
  const activePartnerActorId = useRef(initialQuery.partnerActorId);
  const [search, setSearch] = useState(initialQuery.search);
  const [sort, setSort] = useState<Sort>(initialQuery.sort);
  const [items, setItems] = useState<PartnerCommissionReceivableRegistryResponse["items"]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [registryLoading, setRegistryLoading] = useState(true);
  const [summary, setSummary] = useState<PartnerFinancialSummary | null>(null);
  const [summaryActorId, setSummaryActorId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Readonly<{ partnerActorId: string; response: PartnerCommissionRemittanceResponse }> | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [pending, setPending] = useState<PendingRemittance | null>(null);

  const navigate = useCallback((query: PartnerEarningsInitialQuery, replace = false) => {
    const href = buildHref(pathname, query);
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [pathname, router]);

  const loadSummary = useCallback(async (actorId: string, signal?: AbortSignal) => {
    if (!actorId) {
      setSummary(null);
      setSummaryActorId("");
      setDetailLoading(false);
      return;
    }
    setSummary(null);
    setSummaryActorId("");
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/finance/partner-earnings?partnerActorId=${encodeURIComponent(actorId)}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => null) as { summary?: PartnerFinancialSummary } | null;
      if (!response.ok || !body?.summary) throw new Error(readError(body, "تعذر قراءة تفاصيل المستحقات"));
      if (signal?.aborted) return;
      setSummary(body.summary);
      setSummaryActorId(actorId);
    } catch (value) {
      if (!signal?.aborted) setError(value instanceof Error ? value.message : "تعذر قراءة تفاصيل المستحقات");
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, []);

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

    const controller = new AbortController();
    setRegistryLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "50", sort: initialQuery.sort });
    if (initialQuery.search) params.set("search", initialQuery.search);
    if (initialQuery.cursor) params.set("cursor", initialQuery.cursor);
    void (async () => {
      try {
        const response = await fetch(`/api/finance/partner-commission-receivables?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null) as PartnerCommissionReceivableRegistryResponse | { error?: { message?: string } } | null;
        if (!response.ok || !body || !("items" in body)) throw new Error(readError(body, "تعذر قراءة سجل مستحقات الشركاء"));
        setItems(body.items);
        setNextCursor(body.nextCursor ?? "");
      } catch (value) {
        if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "تعذر قراءة سجل مستحقات الشركاء");
      } finally {
        if (!controller.signal.aborted) setRegistryLoading(false);
      }
    })();
    return () => controller.abort();
  }, [initialQuery.cursor, initialQuery.search, initialQuery.sort]);

  useEffect(() => {
    const actorId = initialQuery.partnerActorId;
    activePartnerActorId.current = actorId;
    setReceipt(null);
    setAmount("");
    setReference("");
    setEvidence("");
    setPending(actorId ? pendingByPartner.current.get(actorId) ?? null : null);
    const controller = new AbortController();
    void loadSummary(actorId, controller.signal);
    return () => controller.abort();
  }, [initialQuery.partnerActorId, loadSummary]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    cursorHistory.current = [];
    currentCursor.current = "";
    requestedCursor.current = "";
    setError("");
    navigate({ search: search.trim().slice(0, 128), sort, cursor: "", partnerActorId: "" });
  };

  const nextPage = () => {
    if (!nextCursor) return;
    cursorHistory.current = [...cursorHistory.current, currentCursor.current];
    currentCursor.current = nextCursor;
    requestedCursor.current = nextCursor;
    navigate({ ...initialQuery, cursor: nextCursor, partnerActorId: "" });
  };

  const previousPage = () => {
    const previous = cursorHistory.current.pop();
    if (previous === undefined) return;
    currentCursor.current = previous;
    requestedCursor.current = previous;
    navigate({ ...initialQuery, cursor: previous, partnerActorId: "" });
  };

  const submitRemittance = async () => {
    const actorId = initialQuery.partnerActorId;
    const selectedSummary = actorId === summaryActorId ? summary : null;
    if (!selectedSummary || !actorId) return;
    let transaction = pendingByPartner.current.get(actorId) ?? null;
    if (!transaction) {
      const amountMinor = Number(amount);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > selectedSummary.outstandingCommissionReceivableMinor || !reference.trim() || !evidence.trim()) {
        setError("أدخل مبلغًا صحيحًا لا يتجاوز العمولة المستحقة، مع مرجع الحوالة ومرجع إثبات التحقق.");
        return;
      }
      transaction = { amountMinor, remittanceReference: reference.trim(), evidenceReference: evidence.trim(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
      pendingByPartner.current.set(actorId, transaction);
      setPending(transaction);
    }
    setMutationBusy(true);
    setError("");
    setReceipt(null);
    try {
      const response = await fetch("/api/finance/partner-earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": transaction.idempotencyKey, "X-Correlation-ID": transaction.correlationId },
        body: JSON.stringify({ partnerActorId: actorId, amountMinor: transaction.amountMinor, remittanceReference: transaction.remittanceReference, evidenceReference: transaction.evidenceReference }),
      });
      const body = await response.json().catch(() => null) as PartnerCommissionRemittanceResponse | { error?: { message?: string } } | null;
      if (!response.ok) {
        const message = readError(body, "تعذر تسجيل الحوالة");
        if (response.status < 500) {
          pendingByPartner.current.delete(actorId);
          if (activePartnerActorId.current === actorId) setPending(null);
        }
        throw new Error(response.status >= 500 ? `${message}؛ أُبقيت بيانات المحاولة ومفتاحها لإعادة آمنة.` : message);
      }
      const result = body as PartnerCommissionRemittanceResponse;
      pendingByPartner.current.delete(actorId);
      if (activePartnerActorId.current === actorId) {
        setPending(null);
        setReceipt({ partnerActorId: actorId, response: result });
        setAmount("");
        setReference("");
        setEvidence("");
        await loadSummary(actorId);
      }
    } catch (value) {
      if (activePartnerActorId.current === actorId) setError(value instanceof Error ? value.message : "تعذر تسجيل الحوالة؛ أعد المحاولة بنفس العملية.");
    } finally {
      setMutationBusy(false);
    }
  };

  const selectedSummary = initialQuery.partnerActorId === summaryActorId ? summary : null;

  return (
    <section className={styles.workspace} aria-labelledby="partner-receivables-title">
      <header className={styles.heading}>
        <div><p className="eyebrow">المالية · سجل تشغيلي</p><h2 id="partner-receivables-title">مستحقات الشركاء</h2></div>
        <p className="muted">يعرض السجل أرصدة عمولات الاستلام المستحقة المفتوحة من WLT. افتح الشريك لقراءة ملخصه أو تسجيل حوالة تم التحقق منها.</p>
      </header>

      <form className={styles.filters} onSubmit={applyFilters}>
        <label className="field-label" htmlFor="partner-receivables-search">البحث بمعرّف الشريك<input id="partner-receivables-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={128} /></label>
        <label className="field-label" htmlFor="partner-receivables-sort">ترتيب السجل<select id="partner-receivables-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="actor_asc">المعرّف تصاعدياً</option><option value="actor_desc">المعرّف تنازلياً</option></select></label>
        <button className="button button-secondary" type="submit" disabled={registryLoading}>تطبيق البحث</button>
      </form>

      {error ? <p className="state-error" role="alert">{error}</p> : null}
      <p className="muted" aria-live="polite">سجلات الصفحة الحالية: {items.length.toLocaleString("ar-YE")}{registryLoading ? " · جارٍ التحديث" : ""}</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">سجل أرصدة عمولات الشركاء المفتوحة</caption>
          <thead><tr><th scope="col">معرّف الشريك</th><th scope="col">حالة الملف المالي</th><th scope="col">المبلغ المستحق</th><th scope="col">التفاصيل</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.partnerActorId}>
            <td><bdi>{item.partnerActorId}</bdi></td>
            <td>{financialProfileStateLabel(item.profileState as PartnerFinancialSummary["profileState"])}</td>
            <td>{formatMoney(item.outstandingCommissionReceivableMinor, item.currency)}</td>
            <td><button className="button button-quiet" type="button" onClick={() => navigate({ ...initialQuery, partnerActorId: item.partnerActorId })} aria-label={`فتح مستحقات الشريك ${item.partnerActorId}`}>فتح التفاصيل</button></td>
          </tr>)}</tbody>
        </table>
        {!registryLoading && items.length === 0 ? <p className={styles.empty}>لا توجد مستحقات مفتوحة مطابقة لهذا البحث.</p> : null}
      </div>

      <nav className={styles.pagination} aria-label="صفحات سجل مستحقات الشركاء">
        <button className="button button-quiet" type="button" onClick={previousPage} disabled={registryLoading || cursorHistory.current.length === 0}>السجلات السابقة</button>
        <button className="button button-quiet" type="button" onClick={nextPage} disabled={registryLoading || !nextCursor}>السجلات التالية</button>
      </nav>

      {initialQuery.partnerActorId ? <section className={styles.detail} aria-labelledby="partner-receivable-detail-title">
        <div className={styles.detailHeading}>
          <div><p className="eyebrow">تفاصيل عند الطلب</p><h3 id="partner-receivable-detail-title">مستحقات الشريك <bdi>{initialQuery.partnerActorId}</bdi></h3></div>
          <button className="button button-quiet" type="button" onClick={() => navigate({ ...initialQuery, partnerActorId: "" })}>إغلاق التفاصيل</button>
        </div>
        {detailLoading ? <p className="muted" role="status">جارٍ قراءة الملخص المالي من WLT…</p> : null}
        {selectedSummary ? <>
          <dl className={styles.metrics}>
            <div><dt>صافي المستحق</dt><dd>{formatMoney(selectedSummary.earnedMinor, selectedSummary.currency)}</dd></div>
            <div><dt>عمولة المنصة</dt><dd>{formatMoney(selectedSummary.commissionMinor, selectedSummary.currency)}</dd></div>
            <div><dt>عمولة الاستلام المفتوحة</dt><dd>{formatMoney(selectedSummary.outstandingCommissionReceivableMinor, selectedSummary.currency)}</dd></div>
            <div><dt>الطلبات المسلّمة</dt><dd>{selectedSummary.orderCount.toLocaleString("ar-YE")}</dd></div>
          </dl>
          <p className="muted">فترة التسوية: {settlementPeriodLabel(selectedSummary.settlementPeriod)} · الحالة المالية: {financialProfileStateLabel(selectedSummary.profileState)}</p>
          {receipt?.partnerActorId === initialQuery.partnerActorId ? <p className="state-success" role="status">سُجلت الحوالة {receipt.response.remittance.remittanceReference} بمبلغ {formatMoney(receipt.response.remittance.amountMinor, receipt.response.remittance.currency)}، وأثبتها المشغّل {receipt.response.remittance.verifiedBy}.</p> : null}
          {selectedSummary.outstandingCommissionReceivableMinor > 0 ? <section className={styles.remittance} aria-labelledby="partner-remittance-title">
            <h4 id="partner-remittance-title">تسجيل حوالة عمولة الاستلام</h4>
            <p className="muted">سجّل المبلغ بعد التحقق من وصوله فعلياً. هذه الحوالة تخص عمولة بثواني فقط ولا تسجل قيمة مبيعات المتجر.</p>
            <div className={styles.formFields}>
              <label className="field-label" htmlFor="commission-remittance-amount">المبلغ بالريال اليمني<input id="commission-remittance-amount" inputMode="numeric" pattern="[0-9]*" value={pending?.amountMinor ?? amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} disabled={mutationBusy || Boolean(pending)} /></label>
              <label className="field-label" htmlFor="commission-remittance-reference">مرجع الحوالة<input id="commission-remittance-reference" value={pending?.remittanceReference ?? reference} onChange={(event) => setReference(event.target.value)} maxLength={128} disabled={mutationBusy || Boolean(pending)} /></label>
              <label className="field-label" htmlFor="commission-remittance-evidence">مرجع إثبات التحقق<input id="commission-remittance-evidence" value={pending?.evidenceReference ?? evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={512} disabled={mutationBusy || Boolean(pending)} /></label>
            </div>
            {pending ? <p className="muted">بقيت محاولة غير محسومة. إعادة الإرسال تستخدم المفتاح والبيانات نفسيهما.</p> : null}
            <button className="button button-primary" type="button" onClick={() => void submitRemittance()} disabled={mutationBusy}>{mutationBusy ? "جارٍ تسجيل الحوالة…" : pending ? "إعادة المحاولة بنفس العملية" : "تسجيل الحوالة بعد التحقق"}</button>
          </section> : <p className="muted">لا يوجد رصيد عمولة مفتوح للتسجيل حالياً.</p>}
        </> : null}
      </section> : null}
    </section>
  );
}
