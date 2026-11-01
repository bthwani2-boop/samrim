// Client-side presentation validation only; WLT remains the financial authority.
export type StoreCommercialFulfillmentMode = "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP";
export type StoreCommercialModel = "COMMISSION" | "SUBSCRIPTION";
export type StoreCommissionRate = Readonly<{ fulfillmentMode: StoreCommercialFulfillmentMode; commissionRateBps: number }>;

const supportedModes = new Set<StoreCommercialFulfillmentMode>(["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]);

export function storeCommercialRatesForProposal(
  modes: readonly StoreCommercialFulfillmentMode[],
  percentageByMode: Readonly<Partial<Record<StoreCommercialFulfillmentMode, string>>>,
  model: StoreCommercialModel,
): StoreCommissionRate[] | null {
  if (!["COMMISSION", "SUBSCRIPTION"].includes(model) ||
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

export type StoreCommercialProposalReadback = Readonly<{
  agreementId: string;
  storeId: string;
  proposedByActorId: string;
  agreementVersion: number;
  status: string;
  reason: string;
  commercialModel: StoreCommercialModel | "HYBRID";
  recurringAmountMinor: number;
  billingPeriod: "NONE" | "MONTHLY" | "ANNUAL";
  billingTimeZone: string;
  invoiceDueDays: number;
  graceDays: number;
  renewalPolicy: "NONE" | "MANUAL" | "AUTOMATIC";
  terminationTerms: string;
  adjustmentTerms: string;
  rates: readonly Readonly<{ fulfillmentMode: string; commissionRateBps: number }>[];
}>;
export type ExpectedStoreCommercialProposal = Readonly<
  Omit<StoreCommercialProposalReadback, "agreementId" | "status" | "commercialModel" | "rates"> & {
    commercialModel: StoreCommercialModel;
    rates: readonly StoreCommissionRate[];
  }
>;

// Verify every consent-bearing term, not just the amount or rates.
// A successful POST or a same-ID GET cannot prove that altered terms were accepted.
export function matchesProposedStoreAgreement(
  actual: StoreCommercialProposalReadback,
  expected: ExpectedStoreCommercialProposal,
): boolean {
  return typeof actual.agreementId === "string" && actual.agreementId.length > 0 &&
    actual.status === "PROPOSED" &&
    actual.storeId === expected.storeId &&
    actual.proposedByActorId === expected.proposedByActorId &&
    actual.agreementVersion === expected.agreementVersion &&
    actual.reason === expected.reason &&
    actual.commercialModel === expected.commercialModel &&
    actual.recurringAmountMinor === expected.recurringAmountMinor &&
    actual.billingPeriod === expected.billingPeriod &&
    actual.billingTimeZone === expected.billingTimeZone &&
    actual.invoiceDueDays === expected.invoiceDueDays &&
    actual.graceDays === expected.graceDays &&
    actual.renewalPolicy === expected.renewalPolicy &&
    actual.terminationTerms === expected.terminationTerms &&
    actual.adjustmentTerms === expected.adjustmentTerms &&
    sameStoreCommercialRates(actual.rates, expected.rates);
}
