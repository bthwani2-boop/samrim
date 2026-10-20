import type { OperatorOperationEvent } from "@bthwani/dsh";

const eventLabels: Readonly<Record<string, string>> = {
  order_created: "إنشاء الطلب",
  order_partner_accepted: "قبول المتجر",
  order_preparing: "بدء التجهيز",
  order_ready_for_dispatch: "جاهز للتوزيع",
  order_ready_for_pickup: "جاهز لاستلام العميل",
  order_picked_up: "استلم العميل طلبه",
  order_rejected: "رفض الطلب",
  order_cancelled: "إلغاء الطلب",
  dispatch_offer_created: "إرسال عرض إلى كابتن",
  dispatch_offer_accepted: "قبول عرض التوصيل",
  dispatch_offer_rejected: "رفض عرض التوصيل",
  dispatch_offer_expired: "انتهاء مهلة العرض",
  captain_assignment_reassigned: "إعادة إسناد التوصيل",
  store_handoff_confirmed: "تأكيد تسليم المتجر",
  captain_pickup_completed: "استلام الكابتن للطلب",
  delivery_completed: "اكتمال التسليم",
  delivery_failed: "تعثر التسليم",
  delivery_recovered: "استعادة مهمة التسليم",
};

export function operationHistoryLabel(event: OperatorOperationEvent): string {
  return eventLabels[event.eventType] ?? "حدث تشغيلي محفوظ";
}
