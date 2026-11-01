// Store Type suggestions are non-binding, but a successful UI update must match WLT's canonical readback.
export type CommissionSuggestionReadback = Readonly<{
  commercialStoreTypeId: string;
  fulfillmentMode: string;
  suggestedCommissionRateBps: number;
  defaultVersion: number;
}>;

export function hasExactCommissionSuggestionReadback(
  rows: readonly CommissionSuggestionReadback[],
  expected: CommissionSuggestionReadback,
): boolean {
  return rows.some((row) =>
    row.commercialStoreTypeId === expected.commercialStoreTypeId &&
    row.fulfillmentMode === expected.fulfillmentMode &&
    row.suggestedCommissionRateBps === expected.suggestedCommissionRateBps &&
    row.defaultVersion === expected.defaultVersion);
}
