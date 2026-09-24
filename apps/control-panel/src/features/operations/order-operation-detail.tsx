"use client";

import { captainAssignmentStateLabel, captainHandoffStateLabel, formatMoney, formatOrderDate, fulfillmentModeLabel, orderStateLabel, paymentMethodLabel, paymentStateLabel, type OperatorOperation } from "@bthwani/dsh";
import Link from "next/link";
import { useEffect, useState } from "react";
import { responseMessage } from "../access/identity-error-message";

export function OrderOperationDetail({ orderId }: Readonly<{ orderId: string }>) {
  const [operation, setOperation] = useState<OperatorOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void fetch(`/api/operations/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return response.json() as Promise<{ operation?: OperatorOperation }>;
      })
      .then((body) => { if (active) setOperation(body.operation ?? null); })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "تعذرت قراءة تفاصيل الطلب.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId]);

  if (loading) return <section className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة تفاصيل الطلب</strong></section>;
  if (error || !operation) return <section className="collection-state" role="alert"><strong>تعذر فتح تفاصيل الطلب</strong><p>{error || "لم تعد تفاصيل هذا الطلب متاحة."}</p><Link className="button button-secondary" href="/operations">العودة إلى العمليات</Link></section>;

  const { order, assignment } = operation;
  return (
    <section className="workspace-page" aria-labelledby="order-operation-title">
      <div className="workspace-page-heading">
        <Link href="/operations">العودة إلى العمليات</Link>
        <p className="eyebrow">مساحة تفاصيل الطلب</p>
        <h1 id="order-operation-title"><bdi dir="ltr">{order.id}</bdi></h1>
        <p className="lead">{operation.storeName} · {orderStateLabel(order.state)}</p>
      </div>
      <div className="workspace-resource-grid">
        <section className="access-card" aria-labelledby="order-summary-title">
          <h2 id="order-summary-title">ملخص الطلب</h2>
          <dl>
            <div><dt>الإجمالي</dt><dd>{formatMoney(order.totalAmountMinor, order.currency)}</dd></div>
            <div><dt>الدفع</dt><dd>{paymentMethodLabel(order.paymentMethod)} · {paymentStateLabel(order.paymentState)}</dd></div>
            <div><dt>طريقة الاستلام</dt><dd>{fulfillmentModeLabel(order.fulfillmentMode)}</dd></div>
            <div><dt>العنوان</dt><dd>{order.addressText || "لا يوجد عنوان توصيل"}</dd></div>
            <div><dt>آخر تحديث</dt><dd><time dateTime={order.updatedAt}>{formatOrderDate(order.updatedAt)}</time></dd></div>
          </dl>
        </section>
        <section className="access-card" aria-labelledby="order-assignment-title">
          <h2 id="order-assignment-title">التوزيع والتسليم</h2>
          {assignment ? <p>{captainAssignmentStateLabel(assignment.state)} · تسليم المتجر: {captainHandoffStateLabel(assignment.handoffState)}</p> : <p>لا يوجد تكليف كابتن حالي.</p>}
        </section>
        <section className="access-card" aria-labelledby="order-items-title">
          <h2 id="order-items-title">العناصر</h2>
          <ul>{order.lines.map((line) => <li key={line.id}>{line.productName}{line.variantTitle ? ` · ${line.variantTitle}` : ""} · {line.finalQuantityBaseUnits} · {formatMoney(line.lineAmountMinor, line.currency)}</li>)}</ul>
        </section>
      </div>
    </section>
  );
}
