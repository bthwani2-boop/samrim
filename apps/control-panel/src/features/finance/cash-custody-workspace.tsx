"use client";

import { type CashCustodyRegistryResponse, formatMoney } from "@bthwani/dsh";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { responseMessage } from "../access/identity-error-message";
import "./cash-custody-workspace.module.css";

type Sort = "collected_asc" | "collected_desc";
export type CashCustodyInitialQuery = Readonly<{ search: string; sort: Sort; cursor: string }>;
type Props = Readonly<{ initialQuery: CashCustodyInitialQuery }>;
type CashCustodyDisplayRegistry = Omit<CashCustodyRegistryResponse, "items"> & Readonly<{ items: ReadonlyArray<CashCustodyRegistryResponse["items"][number] & { captainName?: string }> }>;
type RemittanceAttempt = Readonly<{ evidenceKey: string; evidenceCorrelation: string; reconcileKey: string; reconcileCorrelation: string }>;

const cashCustodyRecoveryKey = "bthwani.finance.cash-custody.recovery.v1";

function readCashCustodyRecovery(): Readonly<{ attempts: Map<string, RemittanceAttempt>; documentIds: Map<string, string>; fingerprints: Map<string, string> }> {
  try {
    const raw = window.sessionStorage.getItem(cashCustodyRecoveryKey);
    if (!raw) return { attempts: new Map(), documentIds: new Map(), fingerprints: new Map() };
    const parsed = JSON.parse(raw) as { version?: unknown; attempts?: unknown; documentIds?: unknown; fingerprints?: unknown };
    if (parsed.version !== 1) return { attempts: new Map(), documentIds: new Map(), fingerprints: new Map() };
    const attempts = new Map<string, RemittanceAttempt>();
    if (parsed.attempts && typeof parsed.attempts === "object") {
      for (const [paymentIntentId, value] of Object.entries(parsed.attempts)) {
        if (!value || typeof value !== "object" || paymentIntentId.length > 128) continue;
        const attempt = value as Record<string, unknown>;
        const fields = [attempt.evidenceKey, attempt.evidenceCorrelation, attempt.reconcileKey, attempt.reconcileCorrelation];
        if (fields.every((field) => typeof field === "string" && field.length >= 8 && field.length <= 128)) {
          attempts.set(paymentIntentId, { evidenceKey: fields[0] as string, evidenceCorrelation: fields[1] as string, reconcileKey: fields[2] as string, reconcileCorrelation: fields[3] as string });
        }
      }
    }
    const readStringMap = (value: unknown, maxLength: number) => {
      const result = new Map<string, string>();
      if (!value || typeof value !== "object") return result;
      for (const [id, item] of Object.entries(value)) {
        if (id.length <= 128 && typeof item === "string" && item.length > 0 && item.length <= maxLength) result.set(id, item);
      }
      return result;
    };
    return { attempts, documentIds: readStringMap(parsed.documentIds, 128), fingerprints: readStringMap(parsed.fingerprints, 512) };
  } catch {
    return { attempts: new Map(), documentIds: new Map(), fingerprints: new Map() };
  }
}

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
  const [registry, setRegistry] = useState<CashCustodyDisplayRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyRemittanceId, setBusyRemittanceId] = useState("");
  const [receiptFiles, setReceiptFiles] = useState<Record<string, File | null>>({});
  const [receiptDocumentIds, setReceiptDocumentIds] = useState<Record<string, string>>({});
  const receiptDocumentIdsRef = useRef<Record<string, string>>({});
  const remittanceAttempts = useRef(new Map<string, RemittanceAttempt>());
  const receiptFingerprints = useRef(new Map<string, string>());
  const registryController = useRef<AbortController | null>(null);

  function persistRemittanceRecovery() {
    try {
      window.sessionStorage.setItem(cashCustodyRecoveryKey, JSON.stringify({
        version: 1,
        attempts: Object.fromEntries(remittanceAttempts.current),
        documentIds: receiptDocumentIdsRef.current,
        fingerprints: Object.fromEntries(receiptFingerprints.current),
      }));
    } catch {
      // WLT remains authoritative; storage failure only disables reload resume.
    }
  }

  function setReceiptDocumentID(paymentIntentID: string, documentID: string) {
    const next = { ...receiptDocumentIdsRef.current, [paymentIntentID]: documentID };
    receiptDocumentIdsRef.current = next;
    setReceiptDocumentIds(next);
    persistRemittanceRecovery();
  }

  function resetRemittanceRecovery(paymentIntentID: string) {
    remittanceAttempts.current.delete(paymentIntentID);
    receiptFingerprints.current.delete(paymentIntentID);
    const next = { ...receiptDocumentIdsRef.current };
    delete next[paymentIntentID];
    receiptDocumentIdsRef.current = next;
    setReceiptDocumentIds(next);
    persistRemittanceRecovery();
  }

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
      const body = await response.json() as CashCustodyDisplayRegistry;
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

  const reconcileCashRemittance = async (item: CashCustodyRegistryResponse["items"][number]) => {
    const receiptFile = receiptFiles[item.paymentIntentId];
    if (item.remittanceState !== "SUBMITTED" || !item.remittanceId) {
      setError("تعذر تحديد سجل التوريد الذي ينتظر المطابقة. أعد قراءة القائمة.");
      return;
    }
    if (busyRemittanceId || (!receiptDocumentIds[item.paymentIntentId] && !receiptFile)) {
      setError("أرفق إيصال التوريد قبل إغلاق العهدة.");
      return;
    }
    let attempt = remittanceAttempts.current.get(item.paymentIntentId);
    if (!attempt) {
      attempt = { evidenceKey: crypto.randomUUID(), evidenceCorrelation: crypto.randomUUID(), reconcileKey: crypto.randomUUID(), reconcileCorrelation: crypto.randomUUID() };
      remittanceAttempts.current.set(item.paymentIntentId, attempt);
      persistRemittanceRecovery();
    }
    setBusyRemittanceId(item.paymentIntentId);
    setError("");
    setNotice("");
    try {
      let evidenceDocumentId = receiptDocumentIds[item.paymentIntentId] ?? "";
      if (!evidenceDocumentId) {
        const form = new FormData();
        form.set("purpose", "TRANSFER_RECEIPT");
        form.set("file", receiptFile!, receiptFile!.name);
        const upload = await fetch("/api/finance/evidence", {
          method: "POST",
          headers: { "Idempotency-Key": attempt.evidenceKey, "X-Correlation-ID": attempt.evidenceCorrelation },
          body: form,
        });
        if (!upload.ok) throw new Error(await responseMessage(upload));
        const uploaded = await upload.json() as { document?: { id?: string } };
        evidenceDocumentId = uploaded.document?.id ?? "";
        if (!evidenceDocumentId) throw new Error("تعذر حفظ الإيصال. أعد المحاولة.");
        setReceiptDocumentID(item.paymentIntentId, evidenceDocumentId);
      }
      const response = await fetch(`/api/finance/cash-remittances/${encodeURIComponent(item.remittanceId)}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.reconcileKey, "X-Correlation-ID": attempt.reconcileCorrelation },
        body: JSON.stringify({ evidenceDocumentId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      await response.json();
      remittanceAttempts.current.delete(item.paymentIntentId);
      receiptFingerprints.current.delete(item.paymentIntentId);
      setReceiptFiles((current) => ({ ...current, [item.paymentIntentId]: null }));
      const nextReceiptDocumentIds = { ...receiptDocumentIdsRef.current };
      delete nextReceiptDocumentIds[item.paymentIntentId];
      receiptDocumentIdsRef.current = nextReceiptDocumentIds;
      setReceiptDocumentIds(nextReceiptDocumentIds);
      persistRemittanceRecovery();
      setNotice("طابق السجل المالي إيصال التوريد وأغلق العهدة في القيد المالي.");
      await loadRegistry();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر مطابقة إيصال التوريد. أعد القراءة قبل إعادة المحاولة.");
    } finally {
      setBusyRemittanceId("");
    }
  };

  useEffect(() => {
    const recovery = readCashCustodyRecovery();
    remittanceAttempts.current = recovery.attempts;
    receiptFingerprints.current = recovery.fingerprints;
    const recoveredDocumentIds = Object.fromEntries(recovery.documentIds);
    receiptDocumentIdsRef.current = recoveredDocumentIds;
    setReceiptDocumentIds(recoveredDocumentIds);
  }, []);

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
        <p>تظل العهدة مفتوحة بعد إرسال الكابتن للمرجع. يرفق موظف المالية إيصال التوريد المحفوظ والمشفّر ويطابقه هنا؛ عندها فقط يقيد السجل المالي الاستلام ويحرر الحجز.</p>
      </div>

      <div className="finance-toolbar">
        <h2 id="cash-custody-title">النقد المحصل عند التسليم</h2>
        <button type="button" className="button button-secondary" onClick={() => void loadRegistry()} disabled={loading}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
      </div>

      <form className="cash-custody-filters" onSubmit={applyFilters}>
        <label className="field-label" htmlFor="cash-custody-search">مرجع التحصيل<input id="cash-custody-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={128} /></label>
        <label className="field-label" htmlFor="cash-custody-sort">ترتيب وقت التحصيل<select id="cash-custody-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="collected_asc">الأقدم أولًا</option><option value="collected_desc">الأحدث أولًا</option></select></label>
        <button className="button button-secondary" type="submit" disabled={loading}>تطبيق البحث</button>
      </form>

      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة سجل حفظ النقد</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void loadRegistry()} disabled={loading}>إعادة المحاولة</button></div> : null}
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {loading && !registry ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة سجل النقد</strong><p>نطلب صفحة محدودة من السجل المالي المعتمد.</p></div> : null}

      {registry ? <>
        <p className="muted" aria-live="polite">صفحة {registry.items.length.toLocaleString("ar-YE")} سجلًا من أصل {registry.totalItems.toLocaleString("ar-YE")}{loading ? " · جارٍ التحديث" : ""}</p>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <caption className="visually-hidden">سجل النقد المفتوح في عهدة الكباتن</caption>
            <thead><tr><th scope="col">مرجع التحصيل</th><th scope="col">الكابتن</th><th scope="col">المبلغ</th><th scope="col">الحالة والمرجع</th><th scope="col">وقت التحصيل</th><th scope="col">إجراء المالية</th></tr></thead>
            <tbody>{registry.items.map((item) => <tr key={item.paymentIntentId}><th scope="row"><bdi dir="ltr">{item.externalReference}</bdi></th><td>{item.captainName || "اسم الكابتن غير متاح"}</td><td dir="ltr"><bdi>{formatMoney(item.amountMinor, item.currency)}</bdi></td><td>{item.remittanceState === "SUBMITTED" ? <><strong>بانتظار مطابقة المالية</strong>{item.remittanceReference ? <small>مرجع الكابتن: <bdi dir="ltr">{item.remittanceReference}</bdi></small> : null}</> : "بانتظار إرسال الكابتن"}</td><td><time dateTime={item.collectedAt}>{new Date(item.collectedAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td>{item.remittanceState === "SUBMITTED" ? <div className="cash-reconciliation-action"><label className="field-label" htmlFor={`cash-receipt-${item.paymentIntentId}`}>إيصال التحويل أو الإيداع<input id={`cash-receipt-${item.paymentIntentId}`} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file) { const fingerprint = `${file.name}:${file.size}:${file.lastModified}`; if (receiptFingerprints.current.get(item.paymentIntentId) !== fingerprint) resetRemittanceRecovery(item.paymentIntentId); receiptFingerprints.current.set(item.paymentIntentId, fingerprint); persistRemittanceRecovery(); } setReceiptFiles((current) => ({ ...current, [item.paymentIntentId]: file })); }} /></label>{receiptDocumentIds[item.paymentIntentId] ? <span className="muted">الإيصال محفوظ لهذه المحاولة</span> : null}<button className="button button-secondary" type="button" onClick={() => void reconcileCashRemittance(item)} disabled={loading || Boolean(busyRemittanceId) || (!receiptDocumentIds[item.paymentIntentId] && !receiptFiles[item.paymentIntentId])}>{busyRemittanceId === item.paymentIntentId ? "جارٍ رفع الإيصال والمطابقة…" : receiptDocumentIds[item.paymentIntentId] ? "مطابقة الإيصال المحفوظ" : "رفع الإيصال ومطابقة التوريد"}</button></div> : <span className="muted">بانتظار الكابتن</span>}</td></tr>)}</tbody>
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
