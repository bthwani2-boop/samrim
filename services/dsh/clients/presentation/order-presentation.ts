import type { FulfillmentMode, Order, PaymentMethod, PaymentState } from "../generated/dsh-types";

const arabicTextLatinNumbersLocale = "ar-YE-u-nu-latn";

const orderStateLabels: Record<Order["state"], string> = {
  CREATED: "تم استلام الطلب",
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
  return available.includes("BTHWANI_CAPTAIN") ? "BTHWANI_CAPTAIN" : available.includes("CUSTOMER_PICKUP") ? "CUSTOMER_PICKUP" : null;
}

export function fulfillmentModeLabel(mode: FulfillmentMode): string {
  return mode === "CUSTOMER_PICKUP" ? "استلم بنفسك من المتجر" : mode === "BTHWANI_CAPTAIN" ? "توصيل بثواني" : "توصيل المتجر";
}

export function paymentMethodLabel(method: PaymentMethod, fulfillmentMode?: FulfillmentMode): string {
  if (method === "CASH_AT_STORE") {
    if (fulfillmentMode === "PARTNER_CAPTAIN") return "الدفع نقدًا لكابتن المتجر عند التسليم";
    if (fulfillmentMode === "CUSTOMER_PICKUP") return "الدفع نقدًا للمتجر عند استلام الطلب";
    return "الدفع نقدًا للمتجر أو كابتنه عند الاستلام";
  }
  return fulfillmentMode === "BTHWANI_CAPTAIN" ? "الدفع نقدًا لكابتن بثواني عند التسليم" : "الدفع نقدًا عند الاستلام";
}

export function paymentStateLabel(state: PaymentState, method?: PaymentMethod, fulfillmentMode?: FulfillmentMode): string {
  if (state === "REQUIRES_COLLECTION") {
    if (fulfillmentMode === "PARTNER_CAPTAIN") return "بانتظار التحصيل عند التسليم من كابتن المتجر";
    if (fulfillmentMode === "CUSTOMER_PICKUP") return "بانتظار دفع المبلغ نقدًا للمتجر عند الاستلام";
    if (fulfillmentMode === "BTHWANI_CAPTAIN") return "بانتظار التحصيل عند التسليم من كابتن بثواني";
    return method === "CASH_AT_STORE" ? "بانتظار دفع المبلغ نقدًا للمتجر أو كابتنه" : "بانتظار التحصيل عند التسليم";
  }
  if (state === "COLLECTED") return "تم تحصيل المبلغ";
  if (state === "CANCELLED") return "أُلغي التحصيل";
  return "الدفع غير مرتبط";
}

export function formatOrderDate(value: string): string {
  return new Intl.DateTimeFormat(arabicTextLatinNumbersLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatQuantity(baseUnit: Order["lines"][number]["baseUnit"], quantity: number): string {
  const unit = baseUnit === "COUNT" ? "قطعة" : baseUnit === "GRAM" ? "غرام" : "مل";
  return `${new Intl.NumberFormat(arabicTextLatinNumbersLocale).format(quantity)} ${unit}`;
}
