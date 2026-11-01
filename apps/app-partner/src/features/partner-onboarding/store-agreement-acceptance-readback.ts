import type { StoreCommercialAgreement } from "./store-commercial-agreement-client";

type CommercialConsentTerms = Pick<
  StoreCommercialAgreement,
  "commercialModel" | "recurringAmountMinor" | "billingPeriod" | "billingTimeZone" |
  "invoiceDueDays" | "graceDays" | "renewalPolicy" | "terminationTerms" | "adjustmentTerms" | "rates"
>;

// An agreement with no rates cannot be reviewed or knowingly accepted.
export function hasReviewableStoreAgreementRates(agreement: Pick<StoreCommercialAgreement, "rates">): boolean {
  return agreement.rates.length > 0;
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
