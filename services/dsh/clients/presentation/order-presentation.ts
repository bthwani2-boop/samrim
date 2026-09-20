import type { Order, PaymentMethod, PaymentState } from "../generated/dsh-types";

const arabicTextLatinNumbersLocale = "ar-YE-u-nu-latn";

const orderStateLabels: Record<Order["state"], string> = {
  CREATED: "تم استلام الطلب",
  PARTNER_ACCEPTED: "قبله المتجر",
  PREPARING: "قيد التجهيز",
  READY_FOR_DISPATCH: "جاهز للتسليم",
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

export function paymentMethodLabel(method: PaymentMethod): string {
  return method === "CASH_ON_DELIVERY" ? "الدفع نقدًا عند الاستلام" : method;
}

export function paymentStateLabel(state: PaymentState): string {
  if (state === "REQUIRES_COLLECTION") return "بانتظار التحصيل عند التسليم";
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
