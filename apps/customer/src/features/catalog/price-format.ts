/** Formats a positive, DSH-confirmed price without changing or recalculating it. */
export function formatPublicPriceYer(priceYer: number): string {
  if (!Number.isSafeInteger(priceYer) || priceYer <= 0) throw new RangeError("INVALID_DSH_PRICE");
  return `${priceYer.toLocaleString("ar-YE")} ريال يمني`;
}
