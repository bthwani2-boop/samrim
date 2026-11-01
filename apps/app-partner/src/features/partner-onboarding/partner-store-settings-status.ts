import type { PartnerStoreOperationalAvailabilityResponse } from "@bthwani/dsh";

/** Describes only canonical DSH orderability; publication alone is insufficient. */
export function storeSettingsStatus(value: PartnerStoreOperationalAvailabilityResponse): string {
  if (value.availability.paused) return "استقبال الطلبات متوقف مؤقتًا";
  const open = value.orderabilityByMode.filter(item => item.state === "OPEN_FOR_ORDERS").length;
  if (open > 0) return "يستقبل الطلبات عبر " + open.toLocaleString("ar-YE") + " من طرق التنفيذ";
  return "لا توجد طريقة تنفيذ تستقبل طلبات حاليًا";
}
