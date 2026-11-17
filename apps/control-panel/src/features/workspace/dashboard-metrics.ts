export type DashboardMetric = Readonly<{
  label: string; value: number; source: "Identity" | "DSH" | "WLT"; observedAt: string;
}>;
export function metricsAreFresh(items: readonly DashboardMetric[], since: number): boolean {
  return items.every((item) => Number.isFinite(item.value) &&
    Number.isFinite(Date.parse(item.observedAt)) && Date.parse(item.observedAt) >= since);
}
