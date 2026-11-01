import type { PartnerStoreOrderSummary } from "@bthwani/dsh";

// Partner-facing customer aggregates are Store-scoped order facts, never a
// directory of customer identities or globally shared customer activity.
export function verifiedPartnerCustomerActivity(
  summary: PartnerStoreOrderSummary | null | undefined,
  storeId: string,
  period: PartnerStoreOrderSummary["period"],
): PartnerStoreOrderSummary | null {
  if (!summary || !storeId || summary.storeId !== storeId || summary.period !== period ||
    !Number.isFinite(Date.parse(summary.measuredAt))) return null;
  const fields = [
    summary.totalOrders, summary.deliveredOrders, summary.pickedUpOrders,
    summary.completedCustomers, summary.returningCustomers,
  ];
  if (!fields.every(value => Number.isSafeInteger(value) && value >= 0) ||
    summary.returningCustomers > summary.completedCustomers ||
    summary.completedCustomers > summary.deliveredOrders + summary.pickedUpOrders ||
    summary.deliveredOrders + summary.pickedUpOrders > summary.totalOrders) return null;
  return summary;
}
