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

// Share of completed Store customers who completed at least two orders in
// the *same selected period*. This is not cross-period retention.
export function partnerRepeatBuyerPercentage(summary: PartnerStoreOrderSummary | null | undefined): number | null {
  const verified = verifiedPartnerCustomerActivity(summary, summary?.storeId ?? "", summary?.period ?? "30d");
  if (!verified || verified.completedCustomers === 0) return null;
  return Math.round((1000 * verified.returningCustomers) / verified.completedCustomers) / 10;
}
