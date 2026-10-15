"use client";

import { PageHeader } from "../../shell/page-header";

import { captainAssignmentStateLabel, captainHandoffStateLabel, formatMoney, formatOrderDate, fulfillmentModeLabel, type OperatorOperation, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { operationActionLabel, operationResponseMessage, resolveOperatorAction } from "./operator-actions";
import { OperationLocationMap } from "./operation-location-map";
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
      if (!body?.operation || body.operation.order?.id !== orderId) {
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

  async function creditCustomerWallet(adjustmentId: string, amountMinor: number) {
    if (busy || loading || amountMinor <= 0 || walletCreditedAdjustments.has(adjustmentId)) return;
    if (!window.confirm(`إضافة ${formatMoney(amountMinor, "YER")} إلى محفظة العميل على نفقة المنصة بعد مراجعة تعديل الطلب؟`)) return;
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
  const countLabel = new Intl.NumberFormat("ar-YE").format(order.lines.length);

  return (
    <section className="order-detail-workspace" aria-labelledby="order-operation-title">
      {embedded ? (
        <header className="ops-inline-detail-header">
          <div><h2 id="order-operation-title">الطلب {order.id}</h2><p>{operation.storeName} · {orderStateLabel(order.state)}</p></div>
          <button type="button" className="ops-close" onClick={onClose} aria-label="إغلاق تفاصيل الطلب">×</button>
        </header>
      ) : <PageHeader id="order-operation-title" title={<>طلب من {operation.storeName}</>} status={<span className="status-badge">{orderStateLabel(order.state)}</span>} actions={<Link className="button button-secondary" href={returnHref()}>الطلبات</Link>} />}

      <div className="order-detail-toolbar">
        {action ? <button type="button" className={`button ${action === "recover" ? "button-secondary" : "button-primary"}`} onClick={() => void runAction()} disabled={busy || loading || actionNeedsReadback}>{busy ? "جارٍ تنفيذ الإجراء…" : operationActionLabel(action)}</button> : <span className="muted">لا يتطلب هذا الطلب إجراءً مباشرًا من المشغل.</span>}
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>{loading ? "جارٍ القراءة…" : "إعادة قراءة الحالة"}</button>
      </div>

      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {actionError ? <div className="managed-status managed-status-warning" role="alert"><strong>لم يكتمل الإجراء</strong><p>{actionError}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>إعادة قراءة الحالة الحالية</button></div> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت إعادة قراءة حالة الطلب</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>إعادة المحاولة</button></div> : null}

      {(
        <section className="order-detail-panel" aria-labelledby="order-overview-title">
          <h2 id="order-overview-title">ملخص الطلب</h2>
          <dl className="order-detail-facts">

            <div><dt>المتجر</dt><dd><Link href={`/partners/stores/${encodeURIComponent(order.storeId)}`}>{operation.storeName}</Link></dd></div>
            <div><dt>عدد العناصر</dt><dd>{countLabel}</dd></div>
            <div><dt>تاريخ الطلب</dt><dd><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></dd></div>
            <div><dt>آخر تحديث</dt><dd><time dateTime={order.updatedAt}>{formatOrderDate(order.updatedAt)}</time></dd></div>
          </dl>
        </section>
      )}

      {(
        <section className="order-detail-panel" aria-labelledby="order-items-title">
          <h2 id="order-items-title">عناصر الطلب</h2>
          {order.lines.length ? <ul className="order-detail-list">{order.lines.map((line) => <li key={line.id}><div><strong>{line.productName}</strong>{line.variantTitle ? <span>{line.variantTitle}</span> : null}</div><span>{new Intl.NumberFormat("ar-YE").format(line.finalQuantityBaseUnits)} {line.baseUnit}</span><strong>{formatMoney(line.lineAmountMinor, line.currency)}</strong></li>)}</ul> : <p className="muted">لا تتوفر عناصر لهذا الطلب.</p>}
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
                    disabled={busy || loading} onClick={() => void creditCustomerWallet(adjustment.id, line.lineAmountMinor)}>
                    {busy ? "جارٍ التحقق..." : `تعويض المحفظة: ${formatMoney(line.lineAmountMinor, line.currency)}`}
                  </button> : null}
                </div>
                {adjustment.actualQuantityBaseUnits ? <span>{new Intl.NumberFormat("ar-YE").format(adjustment.actualQuantityBaseUnits)} {line?.baseUnit ?? ""}</span> : null}
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
            <div><dt>النقد المتبقي عند الاستلام</dt><dd>{formatMoney(order.cashAmountMinor, order.currency)}</dd></div>
          </dl>
        </section>
      )}

      {(
        <section className="order-detail-panel" aria-labelledby="order-assignment-title">
          <h2 id="order-assignment-title">إسناد الكابتن</h2>
          {assignment ? <dl className="order-detail-facts"><div><dt>حالة الإسناد</dt><dd>{captainAssignmentStateLabel(assignment.state)}</dd></div><div><dt>تسليم المتجر</dt><dd>{captainHandoffStateLabel(assignment.handoffState)}</dd></div></dl> : <p>لا يوجد إسناد كابتن حالي لهذا الطلب.</p>}
          <Link className="order-detail-text-link" href="/captains">الانتقال إلى سجل الكباتن</Link>
        </section>
      )}

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