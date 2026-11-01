import type { StoreContentPerformanceSummary } from "./generated/dsh-types";

// Counts remain Store-scoped DSH events. They do not measure unique visitors,
// order-payment capture, settled discount or a cross-period retention cohort.
export function verifiedStoreContentPerformance(
  raw: StoreContentPerformanceSummary | null | undefined,
  storeId: string,
  period: StoreContentPerformanceSummary["period"],
): StoreContentPerformanceSummary | null {
  if (!raw || !storeId || raw.storeId !== storeId || raw.period !== period) return null;
  const counts = [
    raw.contentCount, raw.impressions, raw.clicks,
    raw.attributedOrdersCreated, raw.attributedOrdersCompleted,
  ];
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0)
    || raw.attributedOrdersCompleted > raw.attributedOrdersCreated) return null;
  return raw;
}

export function storeContentEventRatios(
  summary: StoreContentPerformanceSummary | null | undefined,
): { clicksPerHundredImpressions: number | null; completedAttributedOrdersPercent: number | null } {
  const valid = verifiedStoreContentPerformance(summary, summary?.storeId ?? "", summary?.period ?? "all");
  if (!valid) return { clicksPerHundredImpressions: null, completedAttributedOrdersPercent: null };
  const roundedPercent = (top: number, bottom: number): number | null => {
    if (bottom === 0) return null;
    const rate = Math.round((top / bottom) * 1000) / 10;
    return Number.isFinite(rate) ? rate : null;
  };
  return {
    // Independent click and impression events: the ratio can exceed 100.
    clicksPerHundredImpressions: roundedPercent(valid.clicks, valid.impressions),
    completedAttributedOrdersPercent: roundedPercent(valid.attributedOrdersCompleted, valid.attributedOrdersCreated),
  };
}
