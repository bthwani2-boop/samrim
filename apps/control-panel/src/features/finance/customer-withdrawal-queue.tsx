"use client";

import { formatMoney, officialWalletDestinationStatusLabel, officialWalletVerificationStatusLabel, payoutStatusLabel, type CustomerWithdrawalIntakeListResponse, type CustomerWithdrawalIntakeResponse, type CustomerWithdrawalIntakeSummary, type PayoutRequest } from "@bthwani/dsh";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type IntakeStatus = CustomerWithdrawalIntakeSummary["status"];
type RegistrySort = "requested_desc" | "requested_asc";
export type CustomerWithdrawalQueueQuery = Readonly<{ status: string; search: string; sort: RegistrySort; cursor: string; intakeId: string }>;
type Props = Readonly<{ initialQuery: CustomerWithdrawalQueueQuery }>;

const intakeStatusLabels: Record<IntakeStatus, string> = {
  REQUESTED: "طلب جديد",
  DESTINATION_PENDING: "التحقق من وجهة الصرف",
  PAYOUT_HELD: "الرصيد محجوز للصرف",
  REJECTED: "مرفوض",
  COMPLETED: "مكتمل",
};

function message(body: unknown, fallback: string) {
  return body && typeof body === "object" && typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ? (body as { error: { message: string } }).error.message
    : fallback;
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message(body, fallback));
  return body as T;
}

function queryString(query: CustomerWithdrawalQueueQuery) {
  const params = new URLSearchParams({ sort: query.sort });
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.intakeId) params.set("intakeId", query.intakeId);
  return params.toString();
}

export function CustomerWithdrawalQueue({ initialQuery }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "/finance/customer-withdrawals";
  const pendingMutations = useRef(new Map<string, Readonly<{ idempotencyKey: string; correlationId: string }>>());
  const [items, setItems] = useState<ReadonlyArray<CustomerWithdrawalIntakeSummary>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [status, setStatus] = useState(initialQuery.status);
  const [search, setSearch] = useState(initialQuery.search);
  const [sort, setSort] = useState<RegistrySort>(initialQuery.sort);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<CustomerWithdrawalIntakeResponse | null>(null);
  const [detailError, setDetailError] = useState("");
  const [reason, setReason] = useState("");
  const [verificationEvidence, setVerificationEvidence] = useState("");
  const [payoutEvidenceReference, setPayoutEvidenceReference] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registryRefresh, setRegistryRefresh] = useState(0);

  const loadRegistry = useCallback(async (query: CustomerWithdrawalQueueQuery, signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50", sort: query.sort });
      if (query.status) params.set("status", query.status);
      if (query.search) params.set("search", query.search);
      if (query.cursor) params.set("cursor", query.cursor);
      const result = await json<CustomerWithdrawalIntakeListResponse>(
        await fetch(`/api/finance/customer-withdrawal-intakes?${params}`, { cache: "no-store", signal }),
        "تعذر قراءة طابور سحوبات العملاء",
      );
      if (signal.aborted) return;
      setItems(result.intakes);
      setNextCursor(result.nextCursor ?? "");
    } catch (value) {
      if (!signal.aborted) setError(value instanceof Error ? value.message : "تعذر قراءة طابور سحوبات العملاء");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (intakeId: string, signal: AbortSignal) => {
    if (!intakeId) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await json<CustomerWithdrawalIntakeResponse>(
        await fetch(`/api/finance/customer-withdrawal-intakes/${encodeURIComponent(intakeId)}`, { cache: "no-store", signal }),
        "تعذر قراءة تفاصيل طلب السحب",
      );
      if (!signal.aborted) setDetail(result);
    } catch (value) {
      if (!signal.aborted) setDetailError(value instanceof Error ? value.message : "تعذر قراءة تفاصيل طلب السحب");
    } finally {
      if (!signal.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(initialQuery.status);
    setSearch(initialQuery.search);
    setSort(initialQuery.sort);
    void loadRegistry(initialQuery, controller.signal);
    return () => controller.abort();
  }, [initialQuery.status, initialQuery.search, initialQuery.sort, initialQuery.cursor, registryRefresh, loadRegistry]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(initialQuery.intakeId, controller.signal);
    return () => controller.abort();
  }, [initialQuery.intakeId, loadDetail]);

  const navigate = (query: CustomerWithdrawalQueueQuery) => {
    router.push(`${pathname}?${queryString(query)}`, { scroll: false });
  };

  const mutationHeaders = (scope: string) => {
    let value = pendingMutations.current.get(scope);
    if (!value) {
      value = { idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
      pendingMutations.current.set(scope, value);
    }
    return { "Content-Type": "application/json", "Idempotency-Key": value.idempotencyKey, "X-Correlation-ID": value.correlationId };
  };

  const completeMutation = (scope: string) => pendingMutations.current.delete(scope);

  const refreshSelected = async () => {
    const intakeId = initialQuery.intakeId;
    if (!intakeId) return;
    const controller = new AbortController();
    await loadDetail(intakeId, controller.signal);
    setRegistryRefresh((value) => value + 1);
  };

  const act = async (action: "prepare-destination" | "verify-destination" | "activate-destination" | "accept" | "reject") => {
    const intake = detail?.intake;
    if (!intake) return;
    if (action !== "activate-destination" && reason.trim().length < 3) {
      setDetailError("أدخل سبباً واضحاً قبل تنفيذ الإجراء.");
      return;
    }
    if (action === "verify-destination" && !verificationEvidence.trim()) {
      setDetailError("أدخل مرجع دليل التحقق من رقم المحفظة.");
      return;
    }
    setDetailError("");
    setNotice("");
    setLoading(true);
    const payload = action === "verify-destination"
      ? { evidenceReference: verificationEvidence.trim() }
      : action === "activate-destination"
        ? {}
        : { reason: reason.trim() };
    const scope = `intake:${intake.id}:${action}:${JSON.stringify(payload)}`;
    try {
      await json(await fetch(`/api/finance/customer-withdrawal-intakes/${encodeURIComponent(intake.id)}/${action}`, {
        method: "POST",
        headers: mutationHeaders(scope),
        body: JSON.stringify(payload),
      }), "تعذر تنفيذ إجراء طلب السحب");
      completeMutation(scope);
      setNotice("حُفظ الإجراء في WLT وسجل التدقيق.");
      setReason("");
      setVerificationEvidence("");
      await refreshSelected();
    } catch (value) {
      setDetailError(value instanceof Error ? value.message : "تعذر تنفيذ الإجراء");
    } finally {
      setLoading(false);
    }
  };

  const transitionPayout = async (action: "prepare" | "approve") => {
    const intake = detail?.intake;
    if (!intake?.payoutId) return;
    if (reason.trim().length < 3) {
      setDetailError("أدخل سبباً واضحاً قبل تنفيذ الإجراء.");
      return;
    }
    if (action === "prepare" && !payoutEvidenceReference.trim()) {
      setDetailError("أدخل مرجع دليل تهيئة واعتماد المستحق.");
      return;
    }
    setDetailError("");
    setNotice("");
    setLoading(true);
    const payload = action === "prepare"
      ? { reason: reason.trim(), evidenceReference: payoutEvidenceReference.trim() }
      : { reason: reason.trim() };
    const scope = `payout:${intake.payoutId}:${action}:${JSON.stringify(payload)}`;
    try {
      await json(await fetch(`/api/finance/payout-requests/${encodeURIComponent(intake.payoutId)}/${action}`, {
        method: "POST",
        headers: mutationHeaders(scope),
        body: JSON.stringify(payload),
      }), "تعذر تغيير حالة طلب الصرف في WLT");
      completeMutation(scope);
      setNotice(action === "prepare" ? "أُعد طلب الصرف في WLT؛ يلزم اعتماد مستقل." : "اعتمد الطلب في WLT؛ أصبح جاهزاً لدفعة التحويل اليدوي.");
      setReason("");
      setPayoutEvidenceReference("");
      await refreshSelected();
    } catch (value) {
      setDetailError(value instanceof Error ? value.message : "تعذر تغيير حالة طلب الصرف");
    } finally {
      setLoading(false);
    }
  };

  const createPayoutBatch = async () => {
    const payoutId = detail?.intake.payoutId;
    if (!payoutId || detail?.intake.payoutStatus !== "APPROVED") return;
    setDetailError("");
    setNotice("");
    setLoading(true);
    const payload = { payoutIds: [payoutId] };
    const scope = `batch:${payoutId}:${JSON.stringify(payload)}`;
    try {
      const result = await json<{ batch: { id: string; rowCount: number; totalAmountMinor: number; currency: "YER" } }>(
        await fetch("/api/finance/settlement-batches", {
          method: "POST",
          headers: mutationHeaders(scope),
          body: JSON.stringify(payload),
        }),
        "تعذر إنشاء دفعة الصرف اليدوي",
      );
      completeMutation(scope);
      router.push(`/finance/beneficiary-settlement/partners?view=batches&batchId=${encodeURIComponent(result.batch.id)}`);
    } catch (value) {
      setDetailError(value instanceof Error ? value.message : "تعذر إنشاء دفعة الصرف اليدوي");
    } finally {
      setLoading(false);
    }
  };

  const intake = detail?.intake;
  const destination = detail?.destination;
  const showReason = Boolean(intake && (intake.status === "REQUESTED" || intake.status === "DESTINATION_PENDING" || intake.status === "PAYOUT_HELD"));

  return (
    <section aria-labelledby="customer-withdrawals-title">
      <div className="finance-toolbar">
        <div>
          <p className="eyebrow">طابور مالي · حالات فردية</p>
          <h2 id="customer-withdrawals-title">طلبات سحب العملاء الاستثنائية</h2>
        </div>
        <button className="button button-secondary" type="button" onClick={() => setRegistryRefresh((value) => value + 1)} disabled={loading}>
          تحديث السجل
        </button>
      </div>
      <p className="muted">العمليات تسجل التفويض؛ المالية تتحقق من الوجهة وتقبل الطلب أو ترفضه. قبول الطلب يحجز الرصيد في WLT، ثم ينتقل التنفيذ الخارجي والإيصال والمطابقة إلى مكتب الدفعات المشترك.</p>

      <form className="finance-toolbar" onSubmit={(event) => {
        event.preventDefault();
        navigate({ status, search: search.trim(), sort, cursor: "", intakeId: "" });
      }}>
        <label className="field-label" htmlFor="customer-withdrawal-search">بحث بالاسم أو معرّف العميل أو المزوّد أو آخر أربع أرقام للمحفظة
          <input id="customer-withdrawal-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={128} />
        </label>
        <label className="field-label" htmlFor="customer-withdrawal-status">الحالة
          <select id="customer-withdrawal-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">كل الحالات</option>
            {Object.entries(intakeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field-label" htmlFor="customer-withdrawal-sort">ترتيب تاريخ الطلب
          <select id="customer-withdrawal-sort" value={sort} onChange={(event) => setSort(event.target.value as RegistrySort)}>
            <option value="requested_desc">الأحدث أولاً</option>
            <option value="requested_asc">الأقدم أولاً</option>
          </select>
        </label>
        <button className="button button-secondary" type="submit" disabled={loading}>تطبيق البحث والترتيب</button>
      </form>

      {error ? <p className="state-error" role="alert">{error}</p> : null}
      {notice ? <p className="state-success" role="status">{notice}</p> : null}
      <p className="muted" aria-live="polite">السجلات في هذه الصفحة: {items.length.toLocaleString("ar-YE")}{loading ? " · جارٍ التحديث" : ""}</p>

      <div className="finance-table-wrap">
        <table className="finance-table">
          <caption className="sr-only">سجل طلبات سحب العملاء الاستثنائية من WLT</caption>
          <thead><tr><th scope="col">العميل والطلب</th><th scope="col">وجهة الصرف</th><th scope="col">الحالة</th><th scope="col">وقت الطلب</th><th scope="col">المبلغ</th><th scope="col">التفاصيل</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.beneficiaryName}<br /><small><bdi>{item.customerActorId}</bdi></small></td>
                <td>{item.providerKey}<br /><bdi>{item.walletIdentifierMasked}</bdi></td>
                <td>{intakeStatusLabels[item.status]}{item.destinationStatus ? <><br /><small>{officialWalletDestinationStatusLabel(item.destinationStatus)}</small></> : null}{item.destinationVerificationStatus ? <><br /><small>{officialWalletVerificationStatusLabel(item.destinationVerificationStatus)}</small></> : null}</td>
                <td><time dateTime={item.requestedAt}>{new Date(item.requestedAt).toLocaleString("ar-YE")}</time></td>
                <td>{item.payoutAmountMinor != null && item.payoutCurrency ? formatMoney(item.payoutAmountMinor, item.payoutCurrency) : "—"}</td>
                <td><button className="button button-quiet" type="button" onClick={() => navigate({ ...initialQuery, intakeId: item.id })}>مراجعة الطلب</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? <p className="muted">لا توجد طلبات مطابقة لهذه المرشحات.</p> : null}
      </div>
      {nextCursor ? <button className="button button-quiet" type="button" onClick={() => navigate({ ...initialQuery, cursor: nextCursor, intakeId: "" })} disabled={loading}>تحميل السجلات التالية</button> : null}

      {initialQuery.intakeId ? (
        <section className="access-card" aria-labelledby="customer-withdrawal-detail-title">
          <div className="finance-toolbar">
            <div><p className="eyebrow">تفاصيل الطلب · قراءة حديثة من WLT</p><h3 id="customer-withdrawal-detail-title">{intake ? `${intake.beneficiaryName} · ${intakeStatusLabels[intake.status]}` : "مراجعة طلب السحب"}</h3></div>
            <button className="button button-quiet" type="button" onClick={() => navigate({ ...initialQuery, intakeId: "" })}>إغلاق التفاصيل</button>
          </div>
          {detailLoading ? <p className="muted" role="status">جارٍ تحميل بيانات الطلب والرصيد والوجهة…</p> : null}
          {detailError ? <p className="state-error" role="alert">{detailError}</p> : null}
          {intake ? <>
            <p className="muted"><bdi>{intake.id}</bdi> · أُرسل {new Date(intake.requestedAt).toLocaleString("ar-YE")} · هوية مسجلة بالإصدار {intake.beneficiaryIdentityVersion}</p>
            <p>{intake.requestReason}</p>
            <p>مستند التفويض: <a href={`/api/finance/evidence/${encodeURIComponent(intake.requestEvidenceDocumentId)}`}>فتح المستند الخاص</a></p>
            <div className="finance-toolbar"><strong>الرصيد المؤهل الآن: {formatMoney(intake.eligibleAvailableMinor, intake.currency)}</strong><span>المحجوز: {formatMoney(intake.heldMinor, intake.currency)}</span>{intake.payoutAmountMinor != null && intake.payoutCurrency ? <span>مبلغ طلب الصرف: {formatMoney(intake.payoutAmountMinor, intake.payoutCurrency)}</span> : null}</div>
            {destination ? <p className="muted">الوجهة: {intake.providerKey} · <bdi>{destination.walletIdentifierMasked}</bdi> · {officialWalletDestinationStatusLabel(destination.status)} · {officialWalletVerificationStatusLabel(destination.verificationStatus)}</p> : null}
            {intake.resolutionReason ? <p className="muted">سبب الإغلاق: {intake.resolutionReason}</p> : null}
            {showReason ? <label className="field-label" htmlFor="customer-withdrawal-reason">سبب الإجراء
              <input id="customer-withdrawal-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} disabled={loading} />
            </label> : null}
            {intake.status === "REQUESTED" ? <div className="finance-actions"><button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void act("prepare-destination")}>تهيئة وجهة الصرف</button><button className="button button-quiet" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void act("reject")}>رفض الطلب</button></div> : null}
            {intake.status === "DESTINATION_PENDING" && destination?.verificationStatus === "PENDING_VERIFICATION" ? <><label className="field-label" htmlFor="customer-withdrawal-verification-evidence">مرجع دليل التحقق المستقل
              <input id="customer-withdrawal-verification-evidence" value={verificationEvidence} onChange={(event) => setVerificationEvidence(event.target.value)} maxLength={512} disabled={loading} />
            </label><button className="button button-secondary" type="button" disabled={loading || !verificationEvidence.trim()} onClick={() => void act("verify-destination")}>تأكيد التحقق</button></> : null}
            {intake.status === "DESTINATION_PENDING" && destination?.verificationStatus === "VERIFIED" ? <button className="button button-secondary" type="button" disabled={loading} onClick={() => void act("activate-destination")}>تفعيل وجهة الصرف</button> : null}
            {intake.status === "DESTINATION_PENDING" && destination?.status === "ACTIVE_FOR_PAYOUT" ? <button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void act("accept")}>قبول وحجز الرصيد المؤهل</button> : null}
            {intake.status === "PAYOUT_HELD" && intake.payoutStatus === "HELD" ? <><label className="field-label" htmlFor="customer-withdrawal-payout-evidence">مرجع دليل تهيئة الصرف
              <input id="customer-withdrawal-payout-evidence" value={payoutEvidenceReference} onChange={(event) => setPayoutEvidenceReference(event.target.value)} maxLength={512} disabled={loading} />
            </label><button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3 || !payoutEvidenceReference.trim()} onClick={() => void transitionPayout("prepare")}>تهيئة طلب الصرف</button></> : null}
            {intake.status === "PAYOUT_HELD" && intake.payoutStatus === "PREPARED" ? <button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void transitionPayout("approve")}>اعتماد مستقل للصرف</button> : null}
            {intake.status === "PAYOUT_HELD" && intake.payoutStatus === "APPROVED" ? <button className="button button-primary" type="button" disabled={loading} onClick={() => void createPayoutBatch()}>إنشاء الدفعة وفتح مكتب التنفيذ</button> : null}
            {intake.status === "PAYOUT_HELD" && intake.payoutStatus && ["FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION", "CANCELLED"].includes(intake.payoutStatus) ? <p className="muted">يتابع طلب الصرف في مسار الدفعات المشترك · {payoutStatusLabel(intake.payoutStatus as PayoutRequest["status"])}</p> : null}
            {intake.status === "PAYOUT_HELD" && !intake.payoutStatus ? <p className="state-error">تعذر قراءة حالة طلب الصرف من WLT؛ حدّث التفاصيل قبل المتابعة.</p> : null}
          </> : null}
        </section>
      ) : null}
    </section>
  );
}
