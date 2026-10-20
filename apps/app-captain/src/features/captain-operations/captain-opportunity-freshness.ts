// A failed or delayed fetch must never turn historical activity into a live map.
export function isFreshOpportunitySample(measuredAt: string, nowMs = Date.now()): boolean {
  const sampleMs = Date.parse(measuredAt);
  return Number.isFinite(sampleMs)
    && sampleMs <= nowMs + 60_000
    && nowMs - sampleMs <= 3 * 60_000;
}
