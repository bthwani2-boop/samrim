"use client";

import {
  financialProfileStateLabel,
  formatMoney,
  settlementPeriodLabel,
  type PartnerCommissionReceivableRegistryResponse,
  type PartnerCommissionRemittanceResponse,
  type PartnerFinancialSummary,
  type StorePayoutBeneficiaryProfile,
  type StorePayoutRecipientListResponse,
  type StorePayoutRecipientRecord,
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
  evidenceDocumentId: string;
  evidenceUploadIdempotencyKey: string;
  evidenceUploadCorrelationId: string;
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

function payoutProviderLabel(providerKey: string): string {
  return providerKey.trim().replaceAll("_", " ");
}

function payoutRecipientSummary(record: StorePayoutRecipientRecord, profiles: Readonly<Record<string, StorePayoutBeneficiaryProfile>>): string {
  const profile = profiles[record.beneficiaryActorId ?? ""];
  if (record.state === "RECIPIENT_REVIEW_REQUIRED") return profile?.beneficiaryName ? `يحتاج مراجعة · ${profile.beneficiaryName}` : "يحتاج مراجعة";
  if (record.state === "SELECTED_VERIFIED_STAFF") return [profile?.beneficiaryName?.trim() || "موظف موثّق", profile?.phoneMasked?.trim()].filter(Boolean).join(" · ");
  return profile?.beneficiaryName ? `المالك · ${profile.beneficiaryName}` : "المالك";
}

function readError(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function isPartnerCommissionRemittanceResponse(value: unknown): value is PartnerCommissionRemittanceResponse {
  if (!value || typeof value !== "object" || !("remittance" in value) || !("idempotentReplay" in value)) return false;
  const response = value as Partial<PartnerCommissionRemittanceResponse>;
  const remittance = response.remittance;
  if (!remittance) return false;
  return typeof response.idempotentReplay === "boolean"
    && typeof remittance.id === "string"
    && typeof remittance.partnerActorId === "string"
    && Number.isSafeInteger(remittance.amountMinor)
    && remittance.amountMinor > 0
    && remittance.currency === "YER"
    && typeof remittance.remittanceReference === "string"
    && typeof remittance.evidenceDocumentId === "string"
    && remittance.evidenceDocumentId.length > 0
    && typeof remittance.verifiedBy === "string"
    && typeof remittance.verifiedAt === "string"
    && typeof remittance.ledgerTransactionId === "string"
    && typeof remittance.createdAt === "string";
}

const partnerRemittanceRecoveryKey = "bthwani.finance.partner-remittance.recovery.v1";

function readPartnerRemittanceRecovery(): Map<string, PendingRemittance> {
  try {
    const raw = window.sessionStorage.getItem(partnerRemittanceRecoveryKey);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as { version?: unknown; pending?: unknown };
    if (parsed.version !== 1 || !parsed.pending || typeof parsed.pending !== "object") return new Map();
    const recovered = new Map<string, PendingRemittance>();
    for (const [partnerActorId, value] of Object.entries(parsed.pending)) {
      if (!partnerActorId || partnerActorId.length > 128 || !value || typeof value !== "object") continue;
      const attempt = value as Record<string, unknown>;
      const amountMinor = attempt.amountMinor;
      const remittanceReference = attempt.remittanceReference;
      const evidenceDocumentId = attempt.evidenceDocumentId;
      const keys = [attempt.evidenceUploadIdempotencyKey, attempt.evidenceUploadCorrelationId, attempt.idempotencyKey, attempt.correlationId];
      if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor <= 0
        || typeof remittanceReference !== "string" || !remittanceReference.trim() || remittanceReference.length > 128
        || typeof evidenceDocumentId !== "string" || evidenceDocumentId.length > 128
        || keys.some((key) => typeof key !== "string" || key.length < 8 || key.length > 128)) continue;
      recovered.set(partnerActorId, {
        amountMinor,
        remittanceReference,
        evidenceDocumentId,
        evidenceUploadIdempotencyKey: keys[0] as string,
        evidenceUploadCorrelationId: keys[1] as string,
        idempotencyKey: keys[2] as string,
        correlationId: keys[3] as string,
      });
    }
    return recovered;
  } catch {
    return new Map();
  }
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
  const [payoutRecipients, setPayoutRecipients] = useState<StorePayoutRecipientListResponse | null>(null);
  const [payoutRecipientsActorId, setPayoutRecipientsActorId] = useState("");
  const [payoutRecipientsLoading, setPayoutRecipientsLoading] = useState(false);
  const [payoutRecipientsError, setPayoutRecipientsError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Readonly<{ partnerActorId: string; response: PartnerCommissionRemittanceResponse }> | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [pending, setPending] = useState<PendingRemittance | null>(null);

  function persistPendingRemittances() {
    try {
      window.sessionStorage.setItem(partnerRemittanceRecoveryKey, JSON.stringify({ version: 1, pending: Object.fromEntries(pendingByPartner.current) }));
    } catch {
      // WLT remains authoritative; storage failure only disables reload recovery.
    }
  }

  function savePendingRemittance(partnerActorId: string, transaction: PendingRemittance) {
    pendingByPartner.current.set(partnerActorId, transaction);
    persistPendingRemittances();
    if (activePartnerActorId.current === partnerActorId) setPending(transaction);
  }

  function clearPendingRemittance(partnerActorId: string) {
    pendingByPartner.current.delete(partnerActorId);
    persistPendingRemittances();
    if (activePartnerActorId.current === partnerActorId) setPending(null);
  }

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
      const response = await fetch(`/api/finance/partner-earnings?partnerActorId=${encodeURIComponent(actorId)}`, { cache: "no-store", ...(signal ? { signal } : {}) });
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

  const loadPayoutRecipients = useCallback(async (actorId: string, signal?: AbortSignal) => {
    if (!actorId) {
      setPayoutRecipients(null);
      setPayoutRecipientsActorId("");
      setPayoutRecipientsLoading(false);
      setPayoutRecipientsError("");
      return;
    }
    setPayoutRecipients(null);
    setPayoutRecipientsActorId("");
    setPayoutRecipientsLoading(true);
    setPayoutRecipientsError("");
    try {
      const response = await fetch(`/api/finance/partner-payout-recipients?partnerActorId=${encodeURIComponent(actorId)}`, { cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json().catch(() => null) as StorePayoutRecipientListResponse | { error?: { message?: string } } | null;
      if (!response.ok || !body || !("readback" in body)) throw new Error(readError(body, "تعذر قراءة مستلمي صرف المتاجر"));
      if (signal?.aborted) return;
      setPayoutRecipients(body);
      setPayoutRecipientsActorId(actorId);
    } catch (value) {
      if (!signal?.aborted) setPayoutRecipientsError(value instanceof Error ? value.message : "تعذر قراءة مستلمي صرف المتاجر");
    } finally {
      if (!signal?.aborted) setPayoutRecipientsLoading(false);
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
    setEvidenceFile(null);
    setPending(actorId ? pendingByPartner.current.get(actorId) ?? null : null);
    const controller = new AbortController();
    void loadSummary(actorId, controller.signal);
    void loadPayoutRecipients(actorId, controller.signal);
    return () => controller.abort();
  }, [initialQuery.partnerActorId, loadPayoutRecipients, loadSummary]);

  useEffect(() => {
    pendingByPartner.current = readPartnerRemittanceRecovery();
    const actorId = activePartnerActorId.current;
    setPending(actorId ? pendingByPartner.current.get(actorId) ?? null : null);
  }, []);

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
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > selectedSummary.outstandingCommissionReceivableMinor || !reference.trim() || !evidenceFile) {
        setError("أدخل مبلغًا صحيحًا لا يتجاوز العمولة المستحقة ومرجع الحوالة، ثم أرفق إيصال الحوالة.");
        return;
      }
      transaction = { amountMinor, remittanceReference: reference.trim(), evidenceDocumentId: "", evidenceUploadIdempotencyKey: crypto.randomUUID(), evidenceUploadCorrelationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
      savePendingRemittance(actorId, transaction);
    }
    if (!transaction.evidenceDocumentId && !evidenceFile) {
      setError("أعد اختيار ملف الإيصال نفسه لإكمال محاولة الرفع المحفوظة.");
      return;
    }
    setMutationBusy(true);
    setError("");
    setReceipt(null);
    try {
      if (!transaction.evidenceDocumentId) {
        const form = new FormData();
        form.set("purpose", "TRANSFER_RECEIPT");
        form.set("file", evidenceFile!, evidenceFile!.name);
        const upload = await fetch("/api/finance/evidence", {
          method: "POST",
          headers: { "Idempotency-Key": transaction.evidenceUploadIdempotencyKey, "X-Correlation-ID": transaction.evidenceUploadCorrelationId },
          body: form,
        });
        const uploaded = await upload.json().catch(() => null) as { document?: { id?: string }; error?: { message?: unknown } } | null;
        if (!upload.ok) {
          const message = readError(uploaded, "تعذر حفظ إيصال الحوالة");
          if (upload.status < 500) clearPendingRemittance(actorId);
          throw new Error(message);
        }
        const evidenceDocumentId = uploaded?.document?.id ?? "";
        if (!evidenceDocumentId) throw new Error("لم يُرجع WLT معرّف إيصال محفوظًا.");
        transaction = { ...transaction, evidenceDocumentId };
        savePendingRemittance(actorId, transaction);
      }
      const response = await fetch("/api/finance/partner-earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": transaction.idempotencyKey, "X-Correlation-ID": transaction.correlationId },
        body: JSON.stringify({ partnerActorId: actorId, amountMinor: transaction.amountMinor, remittanceReference: transaction.remittanceReference, evidenceDocumentId: transaction.evidenceDocumentId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = readError(body, "تعذر تسجيل الحوالة");
        if (response.status < 500) {
          clearPendingRemittance(actorId);
        }
        throw new Error(response.status >= 500 ? `${message}؛ أُبقيت بيانات المحاولة ومفتاحها لإعادة آمنة.` : message);
      }
      if (!isPartnerCommissionRemittanceResponse(body)) {
        throw new Error("أعاد WLT استجابة غير مكتملة للحوالة؛ بقيت بيانات المحاولة ومفتاحها محفوظين لإعادة آمنة.");
      }
      const result = body;
      clearPendingRemittance(actorId);
      if (activePartnerActorId.current === actorId) {
        setPending(null);
        setReceipt({ partnerActorId: actorId, response: result });
        setAmount("");
        setReference("");
        setEvidenceFile(null);
        await loadSummary(actorId);
      }
    } catch (value) {
      if (activePartnerActorId.current === actorId) setError(value instanceof TypeError ? "انقطع الاتصال أثناء حفظ إيصال الحوالة أو تسجيلها؛ بقيت المحاولة محفوظة لإعادتها بأمان." : value instanceof Error ? value.message : "تعذر تسجيل الحوالة؛ أعد المحاولة بنفس العملية.");
    } finally {
      setMutationBusy(false);
    }
  };

  const selectedSummary = initialQuery.partnerActorId === summaryActorId ? summary : null;
  const selectedPayoutRecipients = initialQuery.partnerActorId === payoutRecipientsActorId ? payoutRecipients : null;

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
          <section className={styles.recipientReadback} aria-labelledby="partner-payout-recipients-title">
            <div className={styles.subheading}>
              <div><h4 id="partner-payout-recipients-title">مستلمو صرف المتاجر</h4><p className="muted">قراءة تشغيلية من WLT مع هوية المستلم وجهة المحفظة المقنّعة؛ لا تعتمد الواجهة على معرّفات Actors للتعرّف على الأشخاص.</p></div>
              <button className="button button-quiet" type="button" disabled={payoutRecipientsLoading} onClick={() => void loadPayoutRecipients(initialQuery.partnerActorId)}>{payoutRecipientsLoading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
            </div>
            {payoutRecipientsError ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة مستلمي الصرف</strong><p>{payoutRecipientsError}</p></div> : null}
            {payoutRecipientsLoading && !selectedPayoutRecipients ? <p className="muted" role="status">جارٍ قراءة مستلمي الصرف من WLT…</p> : null}
            {selectedPayoutRecipients?.readback.recipients.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">مستلمو صرف متاجر الشريك</caption><thead><tr><th scope="col">المتجر</th><th scope="col">المستلم</th><th scope="col">جهة المحفظة</th><th scope="col">الحالة</th><th scope="col">المستحقات المسندة</th></tr></thead><tbody>{selectedPayoutRecipients.readback.recipients.map((record) => {
              const profile = selectedPayoutRecipients.beneficiaryProfiles[record.beneficiaryActorId ?? ""];
              const stateLabel = record.state === "SELECTED_VERIFIED_STAFF" ? "موظف مختار" : record.state === "RECIPIENT_REVIEW_REQUIRED" ? "تحتاج مراجعة المالك" : "المالك الافتراضي";
              return <tr key={record.storeId}><th scope="row">{selectedPayoutRecipients.storeNames[record.storeId] ?? "متجر"}</th><td>{payoutRecipientSummary(record, selectedPayoutRecipients.beneficiaryProfiles)}</td><td>{profile?.providerKey ? <>{payoutProviderLabel(profile.providerKey)}{profile.walletIdentifierMasked ? <> · <bdi dir="ltr">{profile.walletIdentifierMasked}</bdi></> : null}</> : "غير جاهزة"}</td><td>{stateLabel}</td><td>{formatMoney(record.partnerNetMinor, selectedPayoutRecipients.readback.currency)}</td></tr>;
            })}</tbody></table></div> : null}
            {selectedPayoutRecipients && selectedPayoutRecipients.readback.recipients.length === 0 ? <p className={styles.empty}>لا توجد متاجر مرتبطة بهذا الشريك في قراءة الصرف الحالية.</p> : null}
          </section>
          {receipt?.partnerActorId === initialQuery.partnerActorId ? <p className="state-success" role="status">سُجلت الحوالة {receipt.response.remittance.remittanceReference} بمبلغ {formatMoney(receipt.response.remittance.amountMinor, receipt.response.remittance.currency)}، وأثبتها المشغّل {receipt.response.remittance.verifiedBy}. {receipt.response.remittance.evidenceDocumentId ? <a href={`/api/finance/evidence/${encodeURIComponent(receipt.response.remittance.evidenceDocumentId)}`}>فتح إيصال الحوالة</a> : null}</p> : null}
          {selectedSummary.outstandingCommissionReceivableMinor > 0 || pending ? <section className={styles.remittance} aria-labelledby="partner-remittance-title">
            <h4 id="partner-remittance-title">{pending ? "استعادة محاولة حوالة عمولة الاستلام" : "تسجيل حوالة عمولة الاستلام"}</h4>
            {selectedSummary.outstandingCommissionReceivableMinor > 0 ? <p className="muted">أرفق إيصال الحوالة الذي راجعته ثم سجّل المبلغ المتحقق منه. WLT يحفظ الدليل ويربطه بالقيد المالي. هذه الحوالة تخص عمولة بثواني فقط ولا تسجل قيمة مبيعات المتجر.</p> : <p className="muted">لا يوجد رصيد مفتوح حالياً، لكن توجد محاولة سابقة غير محسومة. أعد الطلب المحفوظ بنفس مفتاحه ليعيد WLT النتيجة المؤكدة دون إنشاء قيد مكرر.</p>}
            <div className={styles.formFields}>
              <label className="field-label" htmlFor="commission-remittance-amount">المبلغ بالريال اليمني<input id="commission-remittance-amount" inputMode="numeric" pattern="[0-9]*" value={pending?.amountMinor ?? amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} disabled={mutationBusy || Boolean(pending)} /></label>
              <label className="field-label" htmlFor="commission-remittance-reference">مرجع الحوالة<input id="commission-remittance-reference" value={pending?.remittanceReference ?? reference} onChange={(event) => setReference(event.target.value)} maxLength={128} disabled={mutationBusy || Boolean(pending)} /></label>
              <label className="field-label" htmlFor="commission-remittance-evidence">إيصال الحوالة (PDF أو صورة أو CSV أو Excel، بحد أقصى 10 ميغابايت)<input id="commission-remittance-evidence" type="file" accept="application/pdf,image/jpeg,image/png,text/csv,.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} disabled={mutationBusy || Boolean(pending?.evidenceDocumentId)} /></label>
            </div>
            {pending ? <p className="muted">بقيت محاولة غير محسومة. إعادة التسجيل تستخدم المفاتيح والبيانات نفسيهما{pending.evidenceDocumentId ? " دون إعادة رفع الإيصال" : "؛ أعد اختيار ملف الإيصال نفسه إذا كان الرفع قد انقطع"}.</p> : null}
            {pending?.evidenceDocumentId ? <p className="muted">الإيصال المحفوظ: <a href={`/api/finance/evidence/${encodeURIComponent(pending.evidenceDocumentId)}`}>فتح الإيصال</a></p> : null}
            <button className="button button-primary" type="button" onClick={() => void submitRemittance()} disabled={mutationBusy}>{mutationBusy ? "جارٍ تسجيل الحوالة…" : pending ? "إعادة المحاولة بنفس العملية" : "تسجيل الحوالة بعد التحقق"}</button>
          </section> : <p className="muted">لا يوجد رصيد عمولة مفتوح أو محاولة معلقة لهذا الشريك.</p>}
        </> : null}
      </section> : null}
    </section>
  );
}
