// Client-side presentation validation only; WLT remains the financial authority.
export type StoreCommercialFulfillmentMode = "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP";
export type StoreCommercialModel = "COMMISSION" | "SUBSCRIPTION" | "HYBRID";
export type StoreCommissionRate = Readonly<{ fulfillmentMode: StoreCommercialFulfillmentMode; commissionRateBps: number }>;

const supportedModes = new Set<StoreCommercialFulfillmentMode>(["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]);

export function storeCommercialRatesForProposal(
  modes: readonly StoreCommercialFulfillmentMode[],
  percentageByMode: Readonly<Partial<Record<StoreCommercialFulfillmentMode, string>>>,
  model: StoreCommercialModel,
): StoreCommissionRate[] | null {
  if (!["COMMISSION", "SUBSCRIPTION", "HYBRID"].includes(model) ||
    modes.length < 1 || modes.length > 3 || new Set(modes).size !== modes.length ||
    modes.some(mode => !supportedModes.has(mode))) return null;
  const rates: StoreCommissionRate[] = [];
  for (const mode of modes) {
    const raw = model === "SUBSCRIPTION" ? "0" : percentageByMode[mode] ?? "";
    if (!/^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(raw)) return null;
    const percent = Number(raw);
    const bps = Math.round(percent * 100);
    if (!Number.isFinite(percent) || bps < 0 || bps > 10000 ||
      Math.abs(percent * 100 - bps) > 0.000001) return null;
    rates.push({ fulfillmentMode: mode, commissionRateBps: bps });
  }
  if (model === "HYBRID" && !rates.some(rate => rate.commissionRateBps > 0)) return null;
  return rates;
}


// Equality is a set of per-mode financial facts, not a subset comparison.
// A duplicate rate cannot stand in for an omitted fulfillment mode.
export function sameStoreCommercialRates(
  actual: readonly Readonly<{ fulfillmentMode: string; commissionRateBps: number }>[],
  expected: readonly StoreCommissionRate[],
): boolean {
  if (actual.length !== expected.length || new Set(actual.map(rate => rate.fulfillmentMode)).size !== actual.length) return false;
  return expected.every(rate => actual.some(candidate =>
    candidate.fulfillmentMode === rate.fulfillmentMode && candidate.commissionRateBps === rate.commissionRateBps));
}
