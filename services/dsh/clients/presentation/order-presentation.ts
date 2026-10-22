import type { FulfillmentMode, Order, PaymentMethod, PaymentState } from "../generated/dsh-types";

const arabicTextLatinNumbersLocale = "ar-YE-u-nu-latn";

const orderStateLabels: Record<Order["state"], string> = {
  CREATED: "بانتظار قبول المتجر",
  PARTNER_ACCEPTED: "قبله المتجر",
  PREPARING: "قيد التجهيز",
  READY_FOR_DISPATCH: "جاهز للتسليم إلى الكابتن",
  READY_FOR_PICKUP: "جاهز للاستلام من المتجر",
  PICKED_UP: "تم الاستلام من المتجر",
  CAPTAIN_ASSIGNED: "تم إسناده إلى الكابتن",
  IN_CUSTODY: "مع الكابتن",
  DELIVERED: "تم التسليم",
  DELIVERY_FAILED: "تعذر التسليم",
  REJECTED: "تعذر قبول الطلب",
  CANCELLED: "أُلغي الطلب",
};

export function orderStateLabel(state: Order["state"]): string {
  return orderStateLabels[state];
}

export function formatMoney(amount: number, currency: Order["currency"]): string {
  const currencyLabel = currency === "YER" ? "ريال يمني" : currency;
  return `${new Intl.NumberFormat(arabicTextLatinNumbersLocale, { maximumFractionDigits: 0 }).format(amount)} ${currencyLabel}`;
}

export type CustomerFulfillmentMode = Extract<FulfillmentMode, "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP">;

export function availableCustomerFulfillmentModes(modes: ReadonlyArray<FulfillmentMode>): CustomerFulfillmentMode[] {
  return modes.filter((mode): mode is CustomerFulfillmentMode => mode === "BTHWANI_CAPTAIN" || mode === "PARTNER_CAPTAIN" || mode === "CUSTOMER_PICKUP");
}

export function defaultCustomerFulfillmentMode(modes: ReadonlyArray<FulfillmentMode>): CustomerFulfillmentMode | null {
  const available = availableCustomerFulfillmentModes(modes);
  if (available.includes("BTHWANI_CAPTAIN")) return "BTHWANI_CAPTAIN";
  if (available.includes("CUSTOMER_PICKUP")) return "CUSTOMER_PICKUP";
  return null;
}

export function fulfillmentModeLabel(mode: FulfillmentMode): string {
  if (mode === "CUSTOMER_PICKUP") return "استلم بنفسك من المتجر";
  if (mode === "BTHWANI_CAPTAIN") return "توصيل بثواني";
  return "توصيل المتجر";
}

export function cashCollectionPartyLabel(mode: FulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "كابتن بثواني";
  if (mode === "PARTNER_CAPTAIN") return "المتجر أو مندوبه";
  return "المتجر";
}

// This is a checkout UI allocation, never a substitute for WLT's accepted payment.
export function checkoutWalletAllocation(totalMinor: number, availableMinor: number | null, useWalletBalance: boolean): number | null {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) return null;
  if (!useWalletBalance || totalMinor === 0) return 0;
  if (availableMinor === null || !Number.isSafeInteger(availableMinor) || availableMinor < 0) return null;
  return Math.min(availableMinor, totalMinor);
}

export function paymentMethodLabel(method: PaymentMethod, fulfillmentMode?: FulfillmentMode, cashAmountMinor?: number): string {
  if (cashAmountMinor === 0) return "الدفع من رصيد المحفظة";
  if (method === "CASH_AT_STORE") {
    if (fulfillmentMode === "PARTNER_CAPTAIN") return "الدفع نقدًا للمتجر أو مندوبه عند التسليم";
    if (fulfillmentMode === "CUSTOMER_PICKUP") return "الدفع نقدًا للمتجر عند استلام الطلب";
    return "الدفع نقدًا للمتجر أو كابتنه عند الاستلام";
  }
  return fulfillmentMode === "BTHWANI_CAPTAIN" ? "الدفع نقدًا لكابتن بثواني عند التسليم" : "الدفع نقدًا عند الاستلام";
}

export function paymentStateLabel(state: PaymentState, method?: PaymentMethod, fulfillmentMode?: FulfillmentMode, cashAmountMinor?: number): string {
  if (state === "REQUIRES_COLLECTION") {
    if (cashAmountMinor === 0) return "رصيد العميل محجوز حتى إتمام الاستلام";
    if (fulfillmentMode === "PARTNER_CAPTAIN") return "بانتظار التحصيل عند التسليم من المتجر أو مندوبه";
    if (fulfillmentMode === "CUSTOMER_PICKUP") return "بانتظار دفع المبلغ نقدًا للمتجر عند الاستلام";
    if (fulfillmentMode === "BTHWANI_CAPTAIN") return "بانتظار التحصيل عند التسليم من كابتن بثواني";
    return method === "CASH_AT_STORE" ? "بانتظار دفع المبلغ نقدًا للمتجر أو كابتنه" : "بانتظار التحصيل عند التسليم";
  }
  if (state === "COLLECTED") return "تم سداد المبلغ";
  if (state === "CANCELLED") return "أُلغي التحصيل";
  return "الدفع غير مرتبط";
}

export function orderPaymentDisclosure(order: Pick<Order, "state" | "paymentState" | "paymentMethod" | "fulfillmentMode" | "cashAmountMinor" | "currency">): Readonly<{ amount: string; status: string }> {
  if (order.state === "CANCELLED" || order.state === "REJECTED") {
    if (order.paymentState === "CANCELLED") {
      return { amount: "لا يوجد نقد مطلوب عند استلام هذا الطلب المغلق.", status: "أُلغي التحصيل" };
    }
    if (order.paymentState === "COLLECTED") {
      return { amount: "تم تسجيل دفع لهذا الطلب سابقًا.", status: "مراجعة أي استرداد مطلوبة؛ لا يعني إغلاق الطلب اكتمال الاسترداد." };
    }
    return { amount: "الطلب مغلق؛ لا يوجد تسليم جارٍ.", status: "حالة التحصيل غير مؤكدة بعد إغلاق الطلب. حدّث الحالة أو تواصل مع الدعم للمراجعة." };
  }
  if (order.paymentState === "COLLECTED") {
    return { amount: "تم سداد المبلغ بالكامل.", status: "تم سداد المبلغ" };
  }
  return {
    amount: order.cashAmountMinor === 0
      ? "مغطى بالكامل من رصيد المحفظة"
      : `النقد المتبقي عند الاستلام: ${formatMoney(order.cashAmountMinor, order.currency)}`,
    status: `${paymentMethodLabel(order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)} · ${paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}`,
  };
}

export function formatOrderDate(value: string): string {
  return new Intl.DateTimeFormat(arabicTextLatinNumbersLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatQuantity(baseUnit: Order["lines"][number]["baseUnit"], quantity: number): string {
  let unit = "مل";
  if (baseUnit === "COUNT") unit = "قطعة";
  else if (baseUnit === "GRAM") unit = "غرام";
  return `${new Intl.NumberFormat(arabicTextLatinNumbersLocale).format(quantity)} ${unit}`;
}
