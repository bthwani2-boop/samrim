"use client";

import { captainAssignmentStateLabel, captainHandoffStateLabel, formatMoney, formatOrderDate, fulfillmentModeLabel, type OperatorOperation, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";
import { operationActionLabel, resolveOperatorAction } from "./operator-actions";
import "./operations-workspace.module.css";

type DetailTab = "overview" | "items" | "store" | "fulfillment" | "payment" | "assignment" | "recovery";
const detailTabs: ReadonlyArray<Readonly<{ id: DetailTab; label: string }>> = [
  { id: "overview", label: "نظرة عامة" },
  { id: "items", label: "العناصر" },
  { id: "store", label: "المتجر" },
  { id: "fulfillment", label: "التنفيذ" },
  { id: "payment", label: "الدفع" },
  { id: "assignment", label: "الكابتن والتوزيع" },
  { id: "recovery", label: "الاستعادة" },
];

export function OrderOperationDetail({ orderId }: Readonly<{ orderId: string }>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const params = new URLSearchParams(queryString);
  const requestedTab = params.get("tab") as DetailTab | null;
  const [operation, setOperation] = useState<OperatorOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError("");
    setErrorStatus(0);
    try {
      const response = await fetch(`/api/operations/${encodeURIComponent(orderId)}`, { cache: "no-store" });
      if (!response.ok) {
        setErrorStatus(response.status);
        setError(await responseMessage(response));
        setOperation(null);
        return false;
      }
      const body = await response.json() as { operation?: OperatorOperation };
      setOperation(body.operation ?? null);
      return body.operation !== undefined;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة تفاصيل الطلب.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  const tab = detailTabs.find((item) => item.id === requestedTab && (item.id !== "recovery" || operation?.order.state === "DELIVERY_FAILED"))?.id ?? "overview";
  const tabHref = useCallback((nextTab: DetailTab) => {
    const next = new URLSearchParams(queryString);
    next.set("tab", nextTab);
    return `${pathname}?${next.toString()}`;
  }, [pathname, queryString]);
  const returnHref = useCallback(() => {
    const next = new URLSearchParams(queryString);
    next.delete("tab");
    const serialized = next.toString();
    return serialized ? `/operations?${serialized}` : "/operations";
  }, [queryString]);

  async function runAction() {
    if (!operation || busy) return;
    const { order, assignment } = operation;
    const action = resolveOperatorAction({ state: order.state, assignment });
    if (!action) return;
    setBusy(true);
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
      if (!response.ok) {
        setActionError(response.status === 409 ? "تغيرت حالة الطلب منذ فتحه. أعد قراءة الحالة قبل اتخاذ قرار آخر." : await responseMessage(response));
        return;
      }
      const readbackSucceeded = await load();
      if (readbackSucceeded) setNotice("تم تحديث حالة الطلب بعد إعادة قراءتها من المصدر التشغيلي.");
      else setActionError("أُرسل الإجراء، لكن تعذرت إعادة قراءة الحالة لتأكيد النتيجة. أعد القراءة قبل اتخاذ قرار آخر.");
    } catch (cause) {
      setActionError(isRequestFailure(cause) ? cause.message : "تعذر تنفيذ الإجراء.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !operation) return <section className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة مساحة الطلب</strong></section>;
  if (error || !operation) return <section className="collection-state" role="alert"><strong>{errorStatus === 403 ? "لا تملك صلاحية فتح هذا الطلب" : "تعذر فتح مساحة الطلب"}</strong><p>{error || "لم تعد تفاصيل هذا الطلب متاحة."}</p><div className="order-detail-state-actions"><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>إعادة القراءة</button><Link className="button button-secondary" href={returnHref()}>العودة إلى العمليات</Link></div></section>;

  const { order, assignment } = operation;
  const action = resolveOperatorAction({ state: order.state, assignment });
  const visibleTabs = detailTabs.filter((item) => item.id !== "recovery" || order.state === "DELIVERY_FAILED");
  const countLabel = new Intl.NumberFormat("ar-YE").format(order.lines.length);

  return (
    <section className="order-detail-workspace" aria-labelledby="order-operation-title">
      <div className="workspace-page-heading order-detail-heading">
        <Link href={returnHref()}>العودة إلى مسار الطلبات</Link>
        <p className="eyebrow">مساحة الطلب</p>
        <h1 id="order-operation-title"><bdi dir="ltr">{order.id}</bdi></h1>
        <p className="lead">{operation.storeName} · {orderStateLabel(order.state)}</p>
      </div>

      <nav className="order-detail-tabs" aria-label="مساحات تفاصيل الطلب">
        {visibleTabs.map((item) => <Link key={item.id} href={tabHref(item.id)} aria-current={item.id === tab ? "page" : undefined} className={item.id === tab ? "order-detail-tab is-active" : "order-detail-tab"}>{item.label}</Link>)}
      </nav>

      <div className="order-detail-toolbar">
        {action ? <button type="button" className={`button ${action === "recover" ? "button-secondary" : "button-primary"}`} onClick={() => void runAction()} disabled={busy || loading}>{busy ? "جارٍ تنفيذ الإجراء…" : operationActionLabel(action)}</button> : <span className="muted">لا يتطلب هذا الطلب إجراءً مباشرًا من المشغل.</span>}
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>{loading ? "جارٍ القراءة…" : "إعادة قراءة الحالة"}</button>
      </div>

      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {actionError ? <div className="managed-status managed-status-warning" role="alert"><strong>لم يكتمل الإجراء</strong><p>{actionError}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>إعادة قراءة الحالة الحالية</button></div> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت إعادة قراءة حالة الطلب</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>إعادة المحاولة</button></div> : null}

      {tab === "overview" ? (
        <section className="order-detail-panel" aria-labelledby="order-overview-title">
          <h2 id="order-overview-title">ملخص الطلب</h2>
          <dl className="order-detail-facts">
            <div><dt>الحالة الحالية</dt><dd><span className={`status-badge status-${order.state.toLowerCase()}`}>{orderStateLabel(order.state)}</span></dd></div>
            <div><dt>المتجر</dt><dd><Link href={`/partners/stores/${encodeURIComponent(order.storeId)}`}>{operation.storeName}</Link></dd></div>
            <div><dt>عدد العناصر</dt><dd>{countLabel}</dd></div>
            <div><dt>تاريخ الطلب</dt><dd><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></dd></div>
            <div><dt>آخر تحديث</dt><dd><time dateTime={order.updatedAt}>{formatOrderDate(order.updatedAt)}</time></dd></div>
          </dl>
        </section>
      ) : null}

      {tab === "items" ? (
        <section className="order-detail-panel" aria-labelledby="order-items-title">
          <h2 id="order-items-title">عناصر الطلب</h2>
          {order.lines.length ? <ul className="order-detail-list">{order.lines.map((line) => <li key={line.id}><div><strong>{line.productName}</strong>{line.variantTitle ? <span>{line.variantTitle}</span> : null}</div><span>{new Intl.NumberFormat("ar-YE").format(line.finalQuantityBaseUnits)} {line.baseUnit}</span><strong>{formatMoney(line.lineAmountMinor, line.currency)}</strong></li>)}</ul> : <p className="muted">لا تتوفر عناصر لهذا الطلب.</p>}
        </section>
      ) : null}

      {tab === "store" ? (
        <section className="order-detail-panel" aria-labelledby="order-store-title">
          <h2 id="order-store-title">المتجر المرتبط</h2>
          <p>{operation.storeName}</p>
          <Link className="button button-secondary" href={`/partners/stores/${encodeURIComponent(order.storeId)}`}>فتح مساحة المتجر</Link>
        </section>
      ) : null}

      {tab === "fulfillment" ? (
        <section className="order-detail-panel" aria-labelledby="order-fulfillment-title">
          <h2 id="order-fulfillment-title">التنفيذ والاستلام</h2>
          <dl className="order-detail-facts">
            <div><dt>طريقة التنفيذ</dt><dd>{fulfillmentModeLabel(order.fulfillmentMode)}</dd></div>
            <div><dt>عنوان التوصيل</dt><dd>{order.addressText || "لا يتطلب هذا الطلب عنوان توصيل."}</dd></div>
            <div><dt>تسليم المتجر للكابتن</dt><dd>{assignment ? captainHandoffStateLabel(assignment.handoffState) : "لا يوجد إسناد كابتن حالي."}</dd></div>
          </dl>
        </section>
      ) : null}

      {tab === "payment" ? (
        <section className="order-detail-panel" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">الدفع والمبالغ</h2>
          <dl className="order-detail-facts">
            <div><dt>طريقة الدفع</dt><dd>{paymentMethodLabel(order.paymentMethod)}</dd></div>
            <div><dt>حالة الدفع</dt><dd>{paymentStateLabel(order.paymentState)}</dd></div>
            <div><dt>المجموع قبل الخصم</dt><dd>{formatMoney(order.subtotalAmountMinor, order.currency)}</dd></div>
            <div><dt>الخصم</dt><dd>{formatMoney(order.discountMinor, order.currency)}</dd></div>
            <div><dt>الإجمالي</dt><dd>{formatMoney(order.totalAmountMinor, order.currency)}</dd></div>
          </dl>
        </section>
      ) : null}

      {tab === "assignment" ? (
        <section className="order-detail-panel" aria-labelledby="order-assignment-title">
          <h2 id="order-assignment-title">إسناد الكابتن</h2>
          {assignment ? <dl className="order-detail-facts"><div><dt>حالة الإسناد</dt><dd>{captainAssignmentStateLabel(assignment.state)}</dd></div><div><dt>تسليم المتجر</dt><dd>{captainHandoffStateLabel(assignment.handoffState)}</dd></div></dl> : <p>لا يوجد إسناد كابتن حالي لهذا الطلب.</p>}
          <Link className="order-detail-text-link" href="/captains">الانتقال إلى سجل الكباتن</Link>
        </section>
      ) : null}

      {tab === "recovery" ? (
        <section className="order-detail-panel" aria-labelledby="order-recovery-title">
          <h2 id="order-recovery-title">استعادة التسليم</h2>
          <p>تعذر إكمال التسليم. {assignment ? "راجع حالة الإسناد وتسليم المتجر قبل المتابعة." : "لا يوجد إسناد حالي مرتبط بهذا التعثر."}</p>
          {action === "recover" ? <p>يمكن إعادة الطلب إلى مسار التنفيذ بعد نجاح الإجراء وإعادة قراءة الحالة الكانونية.</p> : <p>لا يتوفر إجراء استعادة لهذا الطلب في حالته الحالية.</p>}
        </section>
      ) : null}
    </section>
  );
}
