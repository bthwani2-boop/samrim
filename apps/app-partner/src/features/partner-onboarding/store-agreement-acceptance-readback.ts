import type { StoreCommercialAgreement } from "./store-commercial-agreement-client";

type CommercialConsentTerms = Pick<
  StoreCommercialAgreement,
  "commercialModel" | "recurringAmountMinor" | "billingPeriod" | "billingTimeZone" |
  "invoiceDueDays" | "graceDays" | "renewalPolicy" | "terminationTerms" | "adjustmentTerms" | "rates"
>;

// WLT owns these contract rules. Reject malformed financial terms before
// displaying an acceptance action; historical HYBRID stays readable only.
export function hasReviewableStoreAgreementRates(agreement: Pick<StoreCommercialAgreement, "commercialModel" | "rates">): boolean {
  const { rates } = agreement;
  const modes = new Set(["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]);
  if (rates.length < 1 || rates.length > modes.size ||
    new Set(rates.map(rate => rate.fulfillmentMode)).size !== rates.length) return false;
  return rates.every(rate => {
    const markup = rate.deliveryMarkupMinor ?? 0;
    const pricing = rate.deliveryPricingMode ?? "DISTANCE";
    const fixed = rate.deliveryFixedFeeMinor ?? 0;
    if (!modes.has(rate.fulfillmentMode) ||
      !Number.isSafeInteger(rate.commissionRateBps) || rate.commissionRateBps < 0 || rate.commissionRateBps > 10000 ||
      !Number.isSafeInteger(markup) || markup < 0 || markup > 10000 ||
      !Number.isSafeInteger(fixed) || fixed < 0 || fixed > 20000 ||
      (agreement.commercialModel === "SUBSCRIPTION" && rate.commissionRateBps !== 0)) return false;
    if (rate.fulfillmentMode === "PARTNER_CAPTAIN") {
      if (!((pricing === "DISTANCE" && fixed === 0) ||
        (pricing === "FREE" && fixed === 0) ||
        (pricing === "FIXED" && fixed > 0))) return false;
    } else if (pricing !== "DISTANCE" || fixed !== 0) return false;
    return markup === 0 || (rate.fulfillmentMode === "BTHWANI_CAPTAIN" && rate.commissionRateBps === 0);
  });
}

function matchesReviewedCommercialTerms(actual: CommercialConsentTerms, reviewed: CommercialConsentTerms): boolean {
  if (actual.rates.length !== reviewed.rates.length ||
    new Set(actual.rates.map(rate => rate.fulfillmentMode)).size !== actual.rates.length ||
    new Set(reviewed.rates.map(rate => rate.fulfillmentMode)).size !== reviewed.rates.length) return false;
  return actual.commercialModel === reviewed.commercialModel &&
    actual.recurringAmountMinor === reviewed.recurringAmountMinor &&
    actual.billingPeriod === reviewed.billingPeriod &&
    actual.billingTimeZone === reviewed.billingTimeZone &&
    actual.invoiceDueDays === reviewed.invoiceDueDays &&
    actual.graceDays === reviewed.graceDays &&
    actual.renewalPolicy === reviewed.renewalPolicy &&
    actual.terminationTerms === reviewed.terminationTerms &&
    actual.adjustmentTerms === reviewed.adjustmentTerms &&
    reviewed.rates.every(rate => actual.rates.some(candidate =>
      candidate.fulfillmentMode === rate.fulfillmentMode &&
      candidate.commissionRateBps === rate.commissionRateBps &&
      candidate.deliveryMarkupMinor === rate.deliveryMarkupMinor &&
      candidate.deliveryPricingMode === rate.deliveryPricingMode &&
      candidate.deliveryFixedFeeMinor === rate.deliveryFixedFeeMinor));
}

export function isConfirmedOwnStoreAgreementAcceptance(
  candidate: StoreCommercialAgreement | undefined,
  expected: Readonly<{
    storeID: string;
    actorID: string;
    agreementID: string;
    expectedVersion: number;
    reviewedAgreement: StoreCommercialAgreement;
  }>,
): boolean {
  return Boolean(
    candidate &&
    candidate.storeId === expected.storeID &&
    candidate.partnerActorId === expected.actorID &&
    candidate.agreementId === expected.agreementID &&
    candidate.agreementVersion === expected.expectedVersion &&
    (candidate.status === "PARTNER_ACCEPTED" || candidate.status === "ACTIVE") &&
    candidate.partnerAcceptedByActorId === expected.actorID &&
    Boolean(candidate.partnerAcceptedAt) &&
    matchesReviewedCommercialTerms(candidate, expected.reviewedAgreement),
  );
}
