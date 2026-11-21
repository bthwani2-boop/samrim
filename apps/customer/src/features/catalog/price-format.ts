import { isPublicOfferPriceYer, type PublicOffer } from "@bthwani/dsh";

/** Formats a positive, DSH-confirmed price without changing or recalculating it. */
export function formatPublicPriceYer(priceYer: PublicOffer["priceYer"]): string {
  if (!isPublicOfferPriceYer(priceYer)) throw new RangeError("INVALID_DSH_PRICE");
  return `${BigInt(priceYer).toLocaleString("ar-YE")} ريال يمني`;
}
