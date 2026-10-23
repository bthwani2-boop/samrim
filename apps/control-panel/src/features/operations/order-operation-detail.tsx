"use client";


import { captainAssignmentStateLabel, captainHandoffStateLabel, cashCollectionPartyLabel, formatMoney, formatOrderDate, fulfillmentModeLabel, type OperatorOperation, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { CustomerContactReviewPanel } from "./customer-contact-review-panel";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { operationHistoryLabel } from "./operation-history";
import { OperatorOrderConversation } from "./operator-order-conversation";
import { operationalAge } from "./operational-age";
import { OperationLocationMap } from "./operation-location-map";
import { OperatorMissionLocation } from "./operator-mission-location";
import { OperatorOrderCases } from "./operator-order-cases";
import { operationActionLabel, operationResponseMessage, resolveOperatorAction } from "./operator-actions";
import { useReadOnReturn } from "../shared/use-read-on-return";

type PendingWalletCompensation = Readonly<{ adjustmentId: string; amountMinor: number }>;
const orderUnitAr: Readonly<Record<string,string>> = {
  COUNT: "قطعة", GRAM: "جرام", KILOGRAM: "كجم", MILLILITER: "مل", LITER: "لتر",
};
function localOrderUnit(unit: string) { return orderUnitAr[unit] ?? unit; }

function WalletCompensationConfirmation({ amountMinor, onCancel, onConfirm }: Readonly<{
  amountMinor: number; onCancel: () => void; onConfirm: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="ops-wallet-confirm-title" className="ops-wallet-confirm"
    onCancel={(event) => { event.preventDefault(); onCancel(); }} onClose={onCancel}>
    <h2 id="ops-wallet-confirm-title">تأكيد تعويض محفظة العميل</h2>
    <p>ستُضاف <strong>{formatMoney(amountMinor, "YER")}</strong> إلى محفظة العميل على نفقة المنصة مقابل تعديل هذا الطلب.</p>
    <p className="muted">راجع المبلغ والتعديل قبل التأكيد. لن تُعرض نتيجة ناجحة إلا بعد التحقق من القيد المالي.</p>
    <div className="action-row">
      <button type="button" className="button button-primary" onClick={onConfirm}>تأكيد إضافة التعويض</button>
      <button type="button" className="button button-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  </dialog>;
}

function OperatorCancellationConfirmation({ needsPartnerReview, onCancel, onConfirm }: Readonly<{
  needsPartnerReview: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, partnerReviewed: boolean) => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [partnerReviewed, setPartnerReviewed] = useState(false);
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={dialogRef} aria-labelledby="operator-cancellation-title" className="ops-wallet-confirm"
    onCancel={(event) => { event.preventDefault(); onCancel(); }} onClose={onCancel}>
    <h2 id="operator-cancellation-title">مراجعة إلغاء الطلب</h2>
    <p>راجع حالة التجهيز مع الشريك قبل القرار. الإلغاء لا يضيف تعويضًا تلقائيًا إلى محفظة العميل.</p>
    <label htmlFor="operator-cancellation-reason">سبب الإلغاء والقرار التشغيلي</label>
    <textarea id="operator-cancellation-reason" className="input" rows={3} maxLength={500} required
      value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اذكر سبب الإلغاء ونتيجة مراجعة الحالة" />
    {needsPartnerReview ? <label><input type="checkbox" checked={partnerReviewed}
      onChange={(event) => setPartnerReviewed(event.target.checked)} /> تم التواصل مع الشريك والتحقق من عدم وجود مانع أو تكلفة غير محسومة</label> : null}
    <div className="action-row">
      <button type="button" className="button button-danger" onClick={() => onConfirm(reason.trim(), partnerReviewed)}
        disabled={Array.from(reason.trim()).length < 12 || (needsPartnerReview && !partnerReviewed)}>تأكيد إلغاء الطلب</button>
      <button type="button" className="button button-secondary" onClick={onCancel}>رجوع</button>
    </div>
  </dialog>;
}

export function OrderOperationDetail({ orderId, embedded = false, onClose, onUpdated }: Readonly<{ orderId: string; embedded?: boolean; onClose?: () => void; onUpdated?: () => void }>) {
  const { state: sessionState } = useSession();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [operation, setOperation] = useState<OperatorOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [showLocationMap, setShowLocationMap] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNeedsReadback, setActionNeedsReadback] = useState(false);
  const [notice, setNotice] = useState("");
  const [walletCreditedAdjustments, setWalletCreditedAdjustments] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingWalletCompensation, setPendingWalletCompensation] = useState<PendingWalletCompensation | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState(false);
  const cancellationAttemptKey = useRef("");
  const loadSequence = useRef(0);
  const actionSequence = useRef(0);
  const actionInFlight = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setOperation(null);
    setNotice("");
    setError("");
    setErrorStatus(0);
    try {
      const response = await fetch(`/api/operations/${encodeURIComponent(orderId)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (sequence !== loadSequence.current) return false;
      if (!response.ok) {
        const message = await operationResponseMessage(response);
        if (sequence !== loadSequence.current) return false;
        setErrorStatus(response.status);
        setError(message);
        setOperation(null);
        return false;
      }
      const body = await response.json() as { operation?: OperatorOperation };
      if (sequence !== loadSequence.current) return false;
      if (!body?.operation || body.operation.order?.id !== orderId
        || !Array.isArray(body.operation.history) || typeof body.operation.historyHasMore !== "boolean"
        || !body.operation.history.every((event) => event && (event.source === "order" || event.source === "captain")
          && typeof event.id === "string" && event.id.length > 0 && typeof event.eventType === "string" && typeof event.state === "string"
          && typeof event.actorId === "string" && event.actorId.length > 0
          && typeof event.at === "string" && Number.isFinite(Date.parse(event.at)))) {
        setError("استجابة تفاصيل الطلب غير صالحة. أعد القراءة.");
        return false;
      }
      setOperation(body.operation);
      setActionNeedsReadback(false);
      setActionError("");
      return true;
    } catch (cause) {
      if (sequence !== loadSequence.current) return false;
      const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      setError(timedOut ? "استغرقت قراءة تفاصيل الطلب وقتًا طويلًا. أعد المحاولة." : cause instanceof Error ? cause.message : "تعذرت قراءة تفاصيل الطلب.");
      return false;
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    actionInFlight.current = false;
    setBusy(false);
    setActionNeedsReadback(false);
    void load();
    return () => {
      loadSequence.current += 1;
      actionSequence.current += 1;
    };
  }, [load]);

  useReadOnReturn(() => {
    if (!actionInFlight.current && !busy && !pendingCancellation && !pendingWalletCompensation) void load();
  }, !loading && !busy && !actionNeedsReadback);

  const returnHref = useCallback(() => {
    const next = new URLSearchParams(queryString);
    next.delete("tab");
    const serialized = next.toString();
    return serialized ? `/operations?${serialized}` : "/operations";
  }, [queryString]);

  async function runAction() {
    if (!operation || busy || loading || actionNeedsReadback || actionInFlight.current) return;
    const { order, assignment } = operation;
    if (order.id !== orderId) return;
    const action = resolveOperatorAction({ state: order.state, assignment });
    if (!action) return;
    const actionVersion = ++actionSequence.current;
    const actionStillCurrent = () => actionVersion === actionSequence.current;
    actionInFlight.current = true;
    setBusy(true);
    setActionNeedsReadback(true);
    setActionError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          orderId: order.id,
          assignmentId: assignment?.id ?? "",
          ...(action === "recover" ? { expectedVersion: assignment?.version } : {}),
        }),
      });
      if (!actionStillCurrent()) return;
      if (!response.ok) {
        const message = response.status === 409 ? "تغيرت حالة الطلب منذ فتحه." : await operationResponseMessage(response);
        if (!actionStillCurrent()) return;
        const verified = await load();
        if (!actionStillCurrent()) return;
        setActionError(verified
          ? `${message} تمت إعادة قراءة الحالة؛ راجعها قبل محاولة أخرى.`
          : `${message} تعذرت إعادة قراءة الحالة؛ لن يُعاد إرسال الإجراء قبل نجاح القراءة.`);
        return;
      }
      const readbackSucceeded = await load();
      if (!actionStillCurrent()) return;
      if (readbackSucceeded) { setNotice("تم تحديث حالة الطلب بعد إعادة قراءتها من المصدر التشغيلي."); onUpdated?.(); }
      else setActionError("أُرسل الإجراء، لكن تعذرت إعادة قراءة الحالة لتأكيد النتيجة. أعد القراءة قبل اتخاذ قرار آخر.");
    } catch (cause) {
      if (!actionStillCurrent()) return;
      const message = isRequestFailure(cause) ? cause.message : "تعذر تنفيذ الإجراء.";
      const verified = await load();
      if (!actionStillCurrent()) return;
      setActionError(verified
        ? `${message} لم نتأكد من نتيجة الإجراء؛ راجع الحالة المعادة قبل إعادة المحاولة.`
        : `${message} لم نتأكد من النتيجة وتعذرت إعادة القراءة؛ لن يُعاد إرسال الإجراء قبل التحقق.`);
    } finally {
      if (actionStillCurrent()) {
        actionInFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function cancelForOperations(reason: string, partnerReviewed: boolean) {
    if (!operation || busy || loading || actionNeedsReadback || actionInFlight.current) return;
    const current = operation.order;
    if (current.id !== orderId || !["CREATED", "PARTNER_ACCEPTED", "PREPARING"].includes(current.state) ||
        current.paymentState !== "REQUIRES_COLLECTION") return;
    if (!cancellationAttemptKey.current) cancellationAttemptKey.current = crypto.randomUUID();
    actionInFlight.current = true;
    setBusy(true);
    setActionNeedsReadback(true);
    setActionError("");
    setNotice("");
    try {
      const response = await identityFetch(`/api/operations/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": cancellationAttemptKey.current },
        body: JSON.stringify({ reason, partnerReviewed, expectedVersion: current.version }),
      });
      if (!response.ok) {
        const message = await operationResponseMessage(response);
        const refreshed = await load();
        setActionError(refreshed ? message : `${message} تعذرت قراءة الحالة الحالية؛ تحقق من الطلب قبل المحاولة.`);
        return;
      }
      setPendingCancellation(false);
      const refreshed = await load();
      if (refreshed && operation.order.id === orderId) {
        setNotice("ألغيت العمليات الطلب وسُجل القرار. راجع الحالة المالية؛ لم يُضف تعويض تلقائي.");
        cancellationAttemptKey.current = "";
        onUpdated?.();
      } else {
        setActionError("تم استلام قرار الإلغاء لكن تعذر التحقق من الحالة. أعد قراءة الطلب قبل المحاولة.");
      }
    } catch {
      const refreshed = await load();
      setActionError(refreshed
        ? "حدث انقطاع أثناء قرار الإلغاء. افحص الحالة المحفوظة قبل إعادة الطلب."
        : "نتيجة الإلغاء غير مؤكدة. لا تعِد التنفيذ قبل قراءة حالة الطلب.");
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function creditCustomerWallet(adjustmentId: string, amountMinor: number) {
    if (busy || loading || amountMinor <= 0 || walletCreditedAdjustments.has(adjustmentId)) return;
    setPendingWalletCompensation(null);
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/finance/order-wallet-compensation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, adjustmentId }),
      });
      if (!response.ok) {
        setActionError(await operationResponseMessage(response));
        return;
      }
      const body = await response.json() as { walletCompensation?: { orderId: string; adjustmentId?: string; amountMinor: number; ledgerTransactionId: string } };
      if (body.walletCompensation?.orderId !== orderId || body.walletCompensation.amountMinor !== amountMinor ||
          !body.walletCompensation.ledgerTransactionId) {
        setActionError("تعذر مطابقة قيد المحفظة مع الطلب؛ يجب التحقق من السجل المالي قبل إعادة المحاولة.");
        return;
      }
      setWalletCreditedAdjustments((previous) => new Set([...previous, adjustmentId]));
      const refreshed = await load();
      setNotice(refreshed
        ? `تم تسجيل ${formatMoney(amountMinor, "YER")} في محفظة العميل والتحقق من حالة الطلب.`
        : `تم تسجيل ${formatMoney(amountMinor, "YER")} في محفظة العميل، لكن تعذرت إعادة قراءة الطلب؛ راجع السجل قبل أي إجراء آخر.`);
    } catch {
      setActionError("تعذّر التأكد من نتيجة التعويض. راجع السجل المالي قبل إعادة المحاولة؛ لا تنشئ تعويضًا آخر.");
    } finally {
      setBusy(false);
    }
  }

  if ((loading && !operation) || (operation && operation.order.id !== orderId)) return <section className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة مساحة الطلب</strong></section>;
  if (error || !operation) return <section className="collection-state" role="alert"><strong>{errorStatus === 403 ? "لا تملك صلاحية فتح هذا الطلب" : "تعذر فتح مساحة الطلب"}</strong><p>{error || "لم تعد تفاصيل هذا الطلب متاحة."}</p><div className="order-detail-state-actions"><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>إعادة القراءة</button>{embedded ? <button type="button" className="button button-secondary" onClick={onClose}>إغلاق</button> : <Link className="button button-secondary" href={returnHref()}>العودة إلى العمليات</Link>}</div></section>;

  const { order, assignment } = operation;
  const action = resolveOperatorAction({ state: order.state, assignment });
  const needsPartnerFollowup = ["CREATED", "PARTNER_ACCEPTED", "PREPARING"].includes(order.state)
    && operationalAge(order.state, order.updatedAt, Date.now()).needsReview;
  const canCancelOrder = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" &&
    sessionState.identity.permissions?.includes("operations") &&
    ["CREATED", "PARTNER_ACCEPTED", "PREPARING"].includes(order.state) &&
    order.paymentState === "REQUIRES_COLLECTION";
  const countLabel = new Intl.NumberFormat("ar-YE").format(order.lines.length);

  return (
    <section className="order-detail-workspace" aria-labelledby={embedded ? undefined : "order-operation-title"}>
      {embedded
        ? <p className="ops-inline-detail-context">{operation.storeName} · {orderStateLabel(order.state)}</p>
        : <PageHeader id="order-operation-title" title={<>طلب من {operation.storeName}</>} status={<span className="status-badge">{orderStateLabel(order.state)}</span>} actions={<Link className="button button-secondary" href={returnHref()}>الطلبات</Link>} />}

      <div className="order-detail-toolbar">
        {action ? <button type="button" className={`button ${action === "recover" ? "button-secondary" : "button-primary"}`} onClick={() => void runAction()} disabled={busy || loading || actionNeedsReadback}>{busy ? "جارٍ تنفيذ الإجراء…" : operationActionLabel(action)}</button>
          : needsPartnerFollowup ? <><span className="operations-attention">تأخر الطلب؛ راجع حالة التجهيز مع الشريك.</span><Link className="button button-secondary" href={`/partners/stores/${encodeURIComponent(order.storeId)}`}>فتح المتجر</Link></>
          : <span className="muted">لا يتطلب هذا الطلب إجراءً مباشرًا من المشغل.</span>}
        {canCancelOrder ? <button type="button" className="button button-secondary" onClick={() => setPendingCancellation(true)} disabled={loading || busy || actionNeedsReadback}>مراجعة الإلغاء</button> : null}
      </div>

      {pendingCancellation ? <OperatorCancellationConfirmation
        needsPartnerReview={order.state === "PARTNER_ACCEPTED" || order.state === "PREPARING"}
        onCancel={() => setPendingCancellation(false)}
        onConfirm={(reason, partnerReviewed) => void cancelForOperations(reason, partnerReviewed)}
      /> : null}
      {pendingWalletCompensation ? <WalletCompensationConfirmation
        amountMinor={pendingWalletCompensation.amountMinor}
        onCancel={() => setPendingWalletCompensation(null)}
        onConfirm={() => void creditCustomerWallet(pendingWalletCompensation.adjustmentId, pendingWalletCompensation.amountMinor)}
      /> : null}

      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {actionError ? <div className="managed-status managed-status-warning" role="alert"><strong>لم يكتمل الإجراء</strong><p>{actionError}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>إعادة قراءة الحالة الحالية</button></div> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت إعادة قراءة حالة الطلب</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>إعادة المحاولة</button></div> : null}

      {(
        <section className="order-detail-panel" aria-labelledby="order-overview-title">
          <h2 id="order-overview-title">ملخص الطلب</h2>
          <dl className="order-detail-facts">

            <div><dt>رقم الطلب</dt><dd><code dir="ltr" style={{ overflowWrap: "anywhere" }}>{order.id}</code></dd></div>
            <div><dt>المتجر</dt><dd><Link href={`/partners/stores/${encodeURIComponent(order.storeId)}`}>{operation.storeName}</Link></dd></div>
            <div><dt>العميل</dt><dd><Link href={`/customers/${encodeURIComponent(order.clientActorId)}`}>فتح ملف العميل</Link></dd></div>

            <div><dt>عدد العناصر</dt><dd>{countLabel}</dd></div>
            <div><dt>تاريخ الطلب</dt><dd><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></dd></div>
            <div><dt>آخر تحديث</dt><dd><time dateTime={order.updatedAt}>{formatOrderDate(order.updatedAt)}</time></dd></div>
          </dl>
        </section>
      )}

      <CustomerContactReviewPanel key={order.id} orderId={order.id} onUpdated={onUpdated} />
      <OperatorMissionLocation key={order.id} orderId={order.id} />
      <OperatorOrderCases key={order.id} orderId={order.id} onUpdated={onUpdated} />

      {(
        <section className="order-detail-panel" aria-labelledby="order-items-title">
          <h2 id="order-items-title">عناصر الطلب</h2>
          {order.lines.length ? <ul className="order-detail-list">{order.lines.map((line) => <li key={line.id}><div><strong>{line.productName}</strong>{line.variantTitle ? <span>{line.variantTitle}</span> : null}</div><span>{new Intl.NumberFormat("ar-YE").format(line.finalQuantityBaseUnits)} {localOrderUnit(line.baseUnit)}</span><strong>{formatMoney(line.lineAmountMinor, line.currency)}</strong></li>)}</ul> : <p className="muted">لا تتوفر عناصر لهذا الطلب.</p>}
          {order.adjustments.length ? <div className="managed-status managed-status-warning" role="status">
            <h3>تعديلات عناصر الطلب</h3>
            <ul className="order-detail-list">{order.adjustments.map((adjustment) => {
              const line = order.lines.find((candidate) => candidate.id === adjustment.orderLineId);
              const stateLabel = adjustment.state === "PROPOSED" ? "بانتظار موافقة العميل" : adjustment.state === "REJECTED" ? "رفض العميل التعديل" : adjustment.state === "APPLIED" ? "تم تعويض العميل في المحفظة" : "معلق للتسوية المالية";
              const compensated = walletCreditedAdjustments.has(adjustment.id);
              const financeAllowed = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" && sessionState.identity.permissions?.includes("finance");
              const eligibleForWallet = financeAllowed && (order.state === "DELIVERED" || order.state === "PICKED_UP") && !order.discountMinor && !order.promotionId &&
                adjustment.kind === "REMOVE_ITEM" && adjustment.state === "FINANCIAL_RECONCILIATION_REQUIRED" &&
                line && line.lineAmountMinor > 0 && line.lineAmountMinor <= order.totalAmountMinor;
              return <li key={adjustment.id}>
                <div>
                  <strong>{adjustment.kind === "REMOVE_ITEM" ? "طلب إزالة صنف" : "تسجيل الكمية الفعلية"}{line ? ` · ${line.productName}` : ""}</strong>
                  <span>{compensated ? "أُضيف التعويض إلى محفظة العميل" : stateLabel}</span>
                  {adjustment.state === "FINANCIAL_RECONCILIATION_REQUIRED" ? <span>لا يتقدم الطلب قبل إغلاق التسوية التشغيلية والمالية اللازمة.</span> : null}
                  {eligibleForWallet && !compensated ? <button type="button" className="button button-secondary"
                    disabled={busy || loading} onClick={() => setPendingWalletCompensation({ adjustmentId: adjustment.id, amountMinor: line.lineAmountMinor })}>
                    {busy ? "جارٍ التحقق..." : `تعويض المحفظة: ${formatMoney(line.lineAmountMinor, line.currency)}`}
                  </button> : null}
                </div>
                {adjustment.actualQuantityBaseUnits ? <span>{new Intl.NumberFormat("ar-YE").format(adjustment.actualQuantityBaseUnits)} {line ? localOrderUnit(line.baseUnit) : ""}</span> : null}
              </li>;
            })}</ul>
          </div> : null}
        </section>
      )}



      {(
        <section className="order-detail-panel" aria-labelledby="order-fulfillment-title">
          <h2 id="order-fulfillment-title">التنفيذ والاستلام</h2>
          <dl className="order-detail-facts">
            <div><dt>طريقة التنفيذ</dt><dd>{fulfillmentModeLabel(order.fulfillmentMode)}</dd></div>
            <div><dt>عنوان التوصيل</dt><dd>{order.addressText || "لا يتطلب هذا الطلب عنوان توصيل."}</dd></div>
            <div><dt>تسليم المتجر للكابتن</dt><dd>{assignment ? captainHandoffStateLabel(assignment.handoffState) : "لا يوجد إسناد كابتن حالي."}</dd></div>
          </dl>
          <details className="ops-location-disclosure" onToggle={(event) => setShowLocationMap(event.currentTarget.open)}>
            <summary>عرض الموقع على الخريطة</summary>
            {showLocationMap ? (order.fulfillmentMode === "CUSTOMER_PICKUP" && order.pickupLocation ? (
              <OperationLocationMap latitude={order.pickupLocation.latitude} longitude={order.pickupLocation.longitude} label={`موقع استلام ${operation.storeName}`} />
            ) : order.fulfillmentMode !== "CUSTOMER_PICKUP" ? (
              <OperationLocationMap latitude={order.addressLatitude} longitude={order.addressLongitude} label="وجهة التوصيل" />
            ) : <p className="muted">إحداثيات موقع الاستلام غير متاحة لهذا الطلب.</p>) : null}
          </details>
        </section>
      )}

      {(
        <section className="order-detail-panel" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">الدفع والمبالغ</h2>
          <dl className="order-detail-facts">
            <div><dt>طريقة الدفع</dt><dd>{paymentMethodLabel(order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</dd></div>
            <div><dt>حالة الدفع</dt><dd>{paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</dd></div>
            <div><dt>المجموع قبل الخصم</dt><dd>{formatMoney(order.subtotalAmountMinor, order.currency)}</dd></div>
            <div><dt>الخصم</dt><dd>{formatMoney(order.discountMinor, order.currency)}</dd></div>
            <div><dt>الإجمالي</dt><dd>{formatMoney(order.totalAmountMinor, order.currency)}</dd></div>
            <div><dt>حصة المحفظة في الطلب</dt><dd>{formatMoney(order.totalAmountMinor - order.cashAmountMinor, order.currency)}</dd></div>
            <div><dt>النقد المحدد عند إنشاء الطلب</dt><dd>{formatMoney(order.cashAmountMinor, order.currency)}</dd></div>
            {order.cashAmountMinor > 0 ? <div><dt>جهة التحصيل المتوقعة</dt><dd>{cashCollectionPartyLabel(order.fulfillmentMode)}</dd></div> : null}
          </dl>
        </section>
      )}

      <OperatorOrderConversation orderId={order.id} />
      {(
        <section className="order-detail-panel" aria-labelledby="order-assignment-title">
          <h2 id="order-assignment-title">إسناد الكابتن</h2>
          {assignment ? <dl className="order-detail-facts"><div><dt>حالة الإسناد</dt><dd>{captainAssignmentStateLabel(assignment.state)}</dd></div><div><dt>تسليم المتجر</dt><dd>{captainHandoffStateLabel(assignment.handoffState)}</dd></div></dl> : <p>لا يوجد إسناد كابتن حالي لهذا الطلب.</p>}
          <Link className="order-detail-text-link" href="/captains">الانتقال إلى سجل الكباتن</Link>
        </section>
      )}

      <section className="order-detail-panel" aria-labelledby="order-history-title">
        <h2 id="order-history-title">سجل الأحداث</h2>
        {operation.history.length > 0 ? (
          <ol className="order-detail-list">
            {operation.history.map((event) => <li key={`${event.source}-${event.id}`}>
              <strong>{operationHistoryLabel(event)}</strong>
              <time dateTime={event.at}>{formatOrderDate(event.at)}</time>
              {event.decisionReason ? <small className="muted">سبب الإلغاء: {event.decisionReason}</small> : null}
              <small className="muted">المنفّذ: <code dir="ltr" style={{ overflowWrap: "anywhere" }}>{event.actorId}</code></small>
            </li>)}
          </ol>
        ) : <p className="muted">لا توجد أحداث محفوظة متاحة لهذا الطلب.</p>}
        {operation.historyHasMore ? <p className="muted">يظهر آخر 100 حدث فقط، وتوجد أحداث أقدم غير معروضة.</p> : null}
        {order.state === "DELIVERY_FAILED" ? <p className="muted">يوضح السجل وقوع التعثر، ولا يُستنتج سبب محدد ما لم يكن مسجلًا في المصدر التشغيلي.</p> : null}
      </section>

      {order.state === "DELIVERY_FAILED" ? (
        <section className="order-detail-panel" aria-labelledby="order-recovery-title">
          <h2 id="order-recovery-title">استعادة التسليم</h2>
          <p>تعذر إكمال التسليم. {assignment ? "راجع حالة الإسناد وتسليم المتجر قبل المتابعة." : "لا يوجد إسناد حالي مرتبط بهذا التعثر."}</p>
          {action === "recover" ? <p>يمكن إعادة الطلب إلى مسار التنفيذ بعد نجاح الإجراء وإعادة قراءة الحالة المعتمدة.</p> : <p>لا يتوفر إجراء استعادة لهذا الطلب في حالته الحالية.</p>}
        </section>
      ) : null}
    </section>
  );
}