"use client";

import { OrderOperationDetail } from "../../../../src/features/operations/order-operation-detail";
import { useSession } from "../../../../src/session/session-provider";
import { use } from "react";

export default function OrderOperationPage({ params }: Readonly<{ params: Promise<{ orderId: string }> }>) {
  const { state } = useSession();
  const { orderId } = use(params);

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return <section className="collection-state" role="alert"><strong>هذه المساحة للمشغّلين فقط</strong></section>;
  }
  return <OrderOperationDetail orderId={orderId} />;
}
