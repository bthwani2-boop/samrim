import type { Order } from "@bthwani/dsh";

/** Presentation follows the persisted DSH order, never a client-side timer. */
export function orderJourneyPresentation(order: Pick<Order, "state" | "fulfillmentMode">) {
  const pickup = order.fulfillmentMode === "CUSTOMER_PICKUP";
  const steps = pickup
    ? ["تأكيد الطلب", "قيد التجهيز", "جاهز للاستلام", "تم الاستلام"] as const
    : ["تأكيد الطلب", "قيد التجهيز", "في الطريق", "تم التسليم"] as const;
  const exception = ["CANCELLED", "REJECTED", "DELIVERY_FAILED"].includes(order.state);
  const completed = order.state === "DELIVERED" || order.state === "PICKED_UP";
  const currentStep = exception ? -1
    : completed ? 3
    : pickup && order.state === "READY_FOR_PICKUP" ? 2
    : !pickup && order.state === "IN_CUSTODY" ? 2
    : order.state === "CREATED" ? 0 : 1;

  const fulfillmentLabel = pickup ? "استلام بنفسي"
    : order.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "توصيل بثواني";
  let title = "المتجر يجهز طلبك";
  let description = "تتحدث الحالة عند تأكيد المرحلة من النظام.";
  if (exception) {
    title = order.state === "CANCELLED" ? "تم إلغاء الطلب" : order.state === "REJECTED" ? "رُفض الطلب" : "تعذر التسليم";
    description = "راجع التفاصيل أو اطلب المساعدة لمعرفة الإجراء المتاح.";
  } else if (order.state === "CREATED") {
    title = "تم استلام طلبك";
    description = "بانتظار تأكيد المتجر.";
  } else if (pickup && order.state === "READY_FOR_PICKUP") {
    title = "طلبك جاهز للاستلام";
    description = "يمكنك التوجه إلى المتجر لاستلام الطلب.";
  } else if (order.state === "IN_CUSTODY") {
    title = order.fulfillmentMode === "PARTNER_CAPTAIN" ? "المتجر يوصّل طلبك" : "طلبك في الطريق إليك";
    description = "الطلب مع الكابتن وفي مرحلة التوصيل.";
  } else if (completed) {
    title = pickup ? "تم استلام طلبك" : "تم تسليم طلبك";
    description = "اكتملت رحلة الطلب.";
  } else if (!pickup && order.state === "READY_FOR_PICKUP") {
    title = "الطلب جاهز لاستلام الكابتن";
    description = "لم تبدأ مرحلة التوصيل بعد.";
  }
  return { steps, currentStep, title, description, fulfillmentLabel, exception };
}
