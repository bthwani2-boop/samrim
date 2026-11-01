import type { CatalogStoreOffer, PublicCatalogResponse } from "@bthwani/dsh";

// A read-only projection of DSH's canonical completed-order 30-day ranking.
// Reject cross-store or malformed results; never infer popularity from loaded offers.
export function scopedPartnerPopularOffers(
  storeId: string,
  result: Pick<PublicCatalogResponse, "storeId" | "offers"> | null,
): readonly CatalogStoreOffer[] | null {
  if (!storeId.trim() || !result || result.storeId !== storeId || !Array.isArray(result.offers) || result.offers.length > 4) return null;
  const ids = new Set<string>();
  for (const offer of result.offers) {
    if (offer.storeId !== storeId || !offer.offerId?.trim() || !offer.productName?.trim() ||
      offer.publicationState !== "published" || !offer.availability || ids.has(offer.offerId)) return null;
    ids.add(offer.offerId);
  }
  return result.offers;
}
