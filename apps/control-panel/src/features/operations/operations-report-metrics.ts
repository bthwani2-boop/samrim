import type { OperatorHomeAnalytics } from "@bthwani/dsh";

type Day = OperatorHomeAnalytics["days"][number];

// Every row is a DSH Store-order creation-day aggregate. Its status is the
// current status at read time, not a historical status for that calendar day.
export function calculateOperationsReportMetrics(days: readonly Day[]) {
  const totalOrders = days.reduce((total, day) => total + day.orders, 0);
  const delivered = days.reduce((total, day) => total + day.delivered, 0);
  const failed = days.reduce((total, day) => total + day.failed, 0);
  const cancelled = days.reduce((total, day) => total + day.cancelled, 0);
  const peak = days.reduce<Day | null>((top, day) =>
    day.orders > (top?.orders ?? 0) ? day : top, null);
  return {
    totalOrders,
    delivered,
    failed,
    cancelled,
    averageOrdersPerDay: days.length ? Math.round(totalOrders * 10 / days.length) / 10 : null,
    peakDay: peak?.day ?? null,
    peakOrders: peak?.orders ?? 0,
  };
}
