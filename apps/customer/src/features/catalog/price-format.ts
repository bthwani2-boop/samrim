import { isPublicOfferPriceYer, type PublicOffer } from "@bthwani/dsh";

/** Formats a positive, DSH-confirmed price without changing or recalculating it. */
export function formatPublicPriceYer(priceYer: PublicOffer["priceYer"]): string {
  if (!isPublicOfferPriceYer(priceYer)) throw new RangeError("INVALID_DSH_PRICE");
  return `${BigInt(priceYer).toLocaleString("ar-YE")} ريال يمني`;
}

/** Display-only DSH estimate; retain integer precision on Hermes and Web. */
export function formatPublicEstimateYer(amount: string): string {
  if (typeof amount !== "string" || !/^[1-9][0-9]{0,28}$/.test(amount)) {
    throw new RangeError("INVALID_DSH_AMOUNT");
  }
  return BigInt(amount).toLocaleString("ar-YE");
}
