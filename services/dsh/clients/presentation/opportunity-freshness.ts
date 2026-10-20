// One presentation rule for Captain and Operator opportunity maps.
// DSH owns the source windows and aggregation; clients reject delayed readback.
export function isFreshOpportunitySample(measuredAt: string, nowMs = Date.now()): boolean {
  if (typeof measuredAt !== "string") return false;
  const sampleMs = Date.parse(measuredAt);
  return Number.isFinite(sampleMs)
    && sampleMs <= nowMs + 60_000
    && nowMs - sampleMs <= 3 * 60_000;
}
